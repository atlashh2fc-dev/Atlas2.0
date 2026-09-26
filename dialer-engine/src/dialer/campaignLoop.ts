import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { computeDialCapacity, computeEffectiveRatio } from "./pacing";
import { originateCall } from "../ami/originate";
import { originatePersonalCallback } from "../ami/originatePersonalCallback";
import { forgetPersonalCallback, trackPersonalCallback } from "../ami/personalCallbacks";
import { ensureQueue, syncQueueMembers } from "../asterisk/configSync";
import { syncAgentPauseStates } from "./agentPause";
import { callerIdPool, pickCallerId } from "./callerId";
import {
  claimDuePersonalCallbacks,
  claimNextDialTargets,
  expirePersonalCallbacks,
  expireStaleQueuedDialAttempts,
  countAvailableAgents,
  countInFlightAttempts,
  getActiveCampaignConfigs,
  getCampaignAgentExtensions,
  getRecentAbandonmentRate,
  getRecentContactRate,
  recordDialAttemptCallerIds,
  registerDialEvent,
} from "../supabaseClient";

/** Lote por ciclo. Con predictivo real (varias líneas por ejecutivo libre)
 * 10 tardaba demasiado en llenar la capacidad de una campaña de 12 personas. */
const MAX_BATCH_PER_TICK = 20;
/** Entregas de compromisos por ciclo: van aparte del pacing del pool. */
const MAX_CALLBACKS_PER_TICK = 5;
const ABANDONMENT_WINDOW_MINUTES = 15;
/** Ventana para medir qué fracción de los intentos termina en conversación. */
const CONTACT_RATE_WINDOW_MINUTES = 30;

type CampaignConfig = {
  campaign_id: string;
  campaign_type: "outbound" | "inbound" | "blending";
  dial_mode: string;
  max_dial_ratio: number;
  caller_id: string | null;
  /** Números a rotar; vacío o null => caller_id. Ver callerId.ts. */
  caller_ids: string[] | null;
  trunk_context: string;
  queue_name: string;
  wrapup_seconds: number;
  is_active: boolean;
  max_redial_attempts: number;
  abandon_timeout_seconds: number;
  target_abandonment_rate: number;
  amd_enabled: boolean;
  personal_callback_enabled: boolean;
  personal_callback_window_minutes: number;
  personal_callback_retry_seconds: number;
  personal_callback_on_expiry: string;
};

/**
 * Un tick = un ciclo de pacing para todas las campañas activas configuradas
 * en DIALER_CAMPAIGN_IDS. server.ts lo agenda en modo single-flight: el
 * siguiente ciclo comienza únicamente después de terminar el actual.
 */
export type CampaignTickReport = {
  ok: boolean;
  configuredCampaigns: number;
  readyQueues: number;
  queueFailures: number;
  campaignFailures: number;
};

export type CampaignTickOptions = {
  /**
   * Ciclo rápido disparado por un evento (ejecutivo liberado, línea que se
   * soltó): sólo pacing del pool, con las colas y pausas que dejó consistente
   * el último ciclo completo. Sin ciclo completo previo, corre completo.
   */
  pacingOnly?: boolean;
  /** Restringe el ciclo rápido a una campaña cuando el evento la conoce. */
  campaignId?: string;
};

// Lo que dejó el último ciclo completo, para que un ciclo rápido no repita
// GetConfig/QueueStatus/QueuePause por campaña (varios segundos con cinco
// campañas activas contra un AMI remoto).
let lastFullTickConfigs: CampaignConfig[] = [];
const lastFullTickReadyCampaignIds = new Set<string>();

/**
 * Anota el número mostrado en cada intento sin frenar el discado: corre en
 * paralelo con los Originate y, si falla (o la migración aún no está), la
 * llamada sale igual y solo se pierde el dato para el informe por número.
 */
function recordCallerIds(
  campaignId: string,
  assignments: Array<{ dialAttemptId: string; callerId: string | null }>
): Promise<void> {
  const items = assignments.flatMap(({ dialAttemptId, callerId }) =>
    callerId ? [{ dialAttemptId, callerId }] : []
  );
  return recordDialAttemptCallerIds(items).then(
    () => undefined,
    (err) => logger.error({ err, campaignId, attempts: items.length }, "No se pudo registrar el número mostrado")
  );
}

export async function runCampaignTick(
  ami: AmiClient,
  campaignIds: string[],
  queueToCampaignId: Map<string, string>,
  options: CampaignTickOptions = {}
): Promise<CampaignTickReport> {
  if (campaignIds.length === 0) {
    return { ok: true, configuredCampaigns: 0, readyQueues: 0, queueFailures: 0, campaignFailures: 0 };
  }

  const pacingOnly = options.pacingOnly === true && lastFullTickConfigs.length > 0;

  let configs: CampaignConfig[];
  if (pacingOnly) {
    configs = lastFullTickConfigs;
  } else {
    try {
      configs = (await getActiveCampaignConfigs(campaignIds)) as CampaignConfig[];
    } catch (err) {
      logger.error({ err }, "No se pudo leer dialer_campaign_configs");
      return {
        ok: false,
        configuredCampaigns: campaignIds.length,
        readyQueues: 0,
        queueFailures: campaignIds.length,
        campaignFailures: 0,
      };
    }
  }

  // Fase 1: dejar colas, miembros y pausas consistentes antes de originar.
  // Antes cada campaña agregaba miembros con Paused=false y podía marcar en
  // la ventana previa al sync de AUX.
  const queueReadyCampaignIds = new Set<string>();
  let queueMembershipChanged = false;
  let queueFailures = 0;
  let campaignFailures = 0;
  if (pacingOnly) {
    for (const id of lastFullTickReadyCampaignIds) queueReadyCampaignIds.add(id);
  } else {
    for (const cfg of configs) {
      queueToCampaignId.set(cfg.queue_name, cfg.campaign_id);

      try {
        // Cola + wrapuptime + miembros primero: esto tiene que reflejar lo que
        // haya en el CRM incluso en campañas manuales (el agente igual marca
        // manualmente y necesita quedar en la queue con el wrapuptime bien).
        const extensions = await getCampaignAgentExtensions(cfg.campaign_id);
        await ensureQueue(ami, cfg.queue_name, cfg.wrapup_seconds);
        queueMembershipChanged =
          (await syncQueueMembers(ami, cfg.queue_name, extensions))
          || queueMembershipChanged;
        queueReadyCampaignIds.add(cfg.campaign_id);
      } catch (err) {
        queueFailures += 1;
        logger.error({ err, campaignId: cfg.campaign_id }, "Sync de cola/extensiones falló");
      }
    }

    await syncAgentPauseStates(ami, { force: queueMembershipChanged });

    lastFullTickConfigs = configs;
    lastFullTickReadyCampaignIds.clear();
    for (const id of queueReadyCampaignIds) lastFullTickReadyCampaignIds.add(id);
  }

  // Fase 2: pacing. Una campaña cuya cola no pudo reconciliarse no origina.
  for (const cfg of configs) {
    if (!queueReadyCampaignIds.has(cfg.campaign_id)) continue;
    if (options.campaignId && cfg.campaign_id !== options.campaignId) continue;

    // 'manual': la campaña existe solo para marcación manual desde la barra
    // CTI (o un botón "Llamar" en la ficha del lead) — el motor no debe
    // auto-discar ni consumir capacidad de agentes disponibles acá.
    if (cfg.dial_mode === "manual") continue;

    try {
      if (!pacingOnly) {
        try {
          const expired = await expireStaleQueuedDialAttempts(cfg.campaign_id);
          if (expired > 0) {
            logger.warn(
              { campaignId: cfg.campaign_id, expired },
              "Intentos queued sin respuesta AMI recuperados"
            );
          }
        } catch (err) {
          // countInFlightAttempts también ignora queued antiguos, por lo que un
          // fallo transitorio del reconciliador no vuelve a congelar la campaña.
          logger.error(
            { err, campaignId: cfg.campaign_id },
            "No se pudieron recuperar intentos queued antiguos"
          );
        }
      }

      // Los compromisos agendados van PRIMERO: un cliente al que se le prometió
      // una llamada a las 15:00 no puede quedar detrás de la marcación masiva.
      // claim_due_personal_callbacks entrega una sola agenda por ejecutivo y
      // solo si está libre; la capacidad del pool se mide DESPUÉS, para que el
      // ejecutivo que recibe su agenda no cuente también como disponible.
      // En un ciclo rápido se omiten: son por hora, no por evento.
      if (!pacingOnly && cfg.personal_callback_enabled !== false) {
        try {
          const callbacks = await claimDuePersonalCallbacks(cfg.campaign_id, MAX_CALLBACKS_PER_TICK);
          // Misma regla que el pool: el cliente que pidió la llamada la
          // recibe desde el número con que se le venía llamando.
          const callbackPool = callerIdPool(cfg);
          const callbackCallerIds = callbacks.map((callback) => ({
            dialAttemptId: callback.dial_attempt_id,
            callerId: pickCallerId(callbackPool, callback.lead_id),
          }));
          const callbackCallerIdsRecorded = recordCallerIds(cfg.campaign_id, callbackCallerIds);
          for (const [index, callback] of callbacks.entries()) {
            // Antes del Originate: los eventos AMI de esta llamada necesitan
            // saber que es una agenda para registrar la conexión al contestar.
            trackPersonalCallback(callback.dial_attempt_id, {
              agentId: callback.agent_id,
              extension: callback.agent_extension,
              campaignId: cfg.campaign_id,
            });
            try {
              await originatePersonalCallback({
                ami,
                target: callback,
                callerId: callbackCallerIds[index].callerId,
                trunkContext: cfg.trunk_context,
              });
            } catch (err) {
              forgetPersonalCallback(callback.dial_attempt_id);
              logger.error({ err, callback }, "No se pudo entregar un compromiso agendado");
              await registerDialEvent({
                dialAttemptId: callback.dial_attempt_id,
                eventType: "failed",
                payload: { stage: "ami_action", kind: "personal_callback" },
                hangupCause: "AMI_ACTION_REJECTED",
              }).catch((registerErr) =>
                logger.error(
                  { err: registerErr, callback },
                  "No se pudo terminalizar el compromiso rechazado por AMI"
                )
              );
            }
          }
          await callbackCallerIdsRecorded;

          const released = await expirePersonalCallbacks(cfg.campaign_id);
          if (released > 0) {
            logger.info(
              { campaignId: cfg.campaign_id, released },
              "Compromisos vencidos liberados al pool de la campaña"
            );
          }
        } catch (err) {
          logger.error({ err, campaignId: cfg.campaign_id }, "Fallo el ciclo de compromisos agendados");
        }
      }

      // An inbound digital campaign can schedule telephone callbacks without
      // becoming an outbound pool. Its explicit commitments are processed
      // above; ordinary WhatsApp leads must never be auto-dialed here.
      if (cfg.campaign_type === "inbound") continue;

      const [available, inFlight] = await Promise.all([
        countAvailableAgents(cfg.campaign_id),
        countInFlightAttempts(cfg.campaign_id),
      ]);

      // Solo en modo predictivo esto hace algo distinto de usar
      // max_dial_ratio tal cual — ver computeEffectiveRatio en pacing.ts.
      let effectiveRatio = cfg.max_dial_ratio;
      if (cfg.dial_mode === "predictive") {
        const [abandonment, contact] = await Promise.allSettled([
          getRecentAbandonmentRate(cfg.campaign_id, ABANDONMENT_WINDOW_MINUTES),
          getRecentContactRate(cfg.campaign_id, CONTACT_RATE_WINDOW_MINUTES),
        ]);
        let measuredAbandonmentRate: number | null = null;
        if (abandonment.status === "fulfilled") measuredAbandonmentRate = abandonment.value;
        else logger.error({ err: abandonment.reason, campaignId: cfg.campaign_id }, "No se pudo medir abandono reciente; se usa el ratio anterior");
        let measuredContactRate: number | null = null;
        if (contact.status === "fulfilled") measuredContactRate = contact.value;
        else logger.error({ err: contact.reason, campaignId: cfg.campaign_id }, "No se pudo medir la tasa de contacto; se usa el ratio anterior");

        effectiveRatio = computeEffectiveRatio({
          campaignId: cfg.campaign_id,
          dialMode: cfg.dial_mode,
          baseRatio: cfg.max_dial_ratio,
          targetAbandonmentRate: cfg.target_abandonment_rate,
          measuredAbandonmentRate,
          measuredContactRate,
        });
        logger.info(
          {
            campaignId: cfg.campaign_id,
            measuredAbandonmentRate,
            measuredContactRate,
            effectiveRatio,
            ceiling: cfg.max_dial_ratio,
            targetAbandonmentRate: cfg.target_abandonment_rate,
          },
          "Ratio predictivo ajustado"
        );
      }

      const capacity = computeDialCapacity({
        availableAgents: available,
        ratio: effectiveRatio,
        inFlight,
        maxBatchPerTick: MAX_BATCH_PER_TICK,
      });

      if (capacity <= 0) continue;

      const targets = await claimNextDialTargets(cfg.campaign_id, capacity);
      if (targets.length === 0) continue;

      logger.info(
        { campaignId: cfg.campaign_id, available, inFlight, capacity, claimed: targets.length, pacingOnly },
        "Originando lote de discado"
      );

      const pool = callerIdPool(cfg);
      const assignments = targets.map((target) => ({
        dialAttemptId: target.dial_attempt_id,
        callerId: pickCallerId(pool, target.lead_id),
      }));
      const callerIdsRecorded = recordCallerIds(cfg.campaign_id, assignments);

      for (const [index, target] of targets.entries()) {
        try {
          await originateCall({
            ami,
            target,
            campaignId: cfg.campaign_id,
            queueName: cfg.queue_name,
            callerId: assignments[index].callerId,
            trunkContext: cfg.trunk_context,
            abandonTimeoutSeconds: cfg.abandon_timeout_seconds,
            amdEnabled: cfg.amd_enabled,
          });
        } catch (err) {
          logger.error({ err, target }, "Originate falló para un lead");
          await registerDialEvent({
            dialAttemptId: target.dial_attempt_id,
            eventType: "failed",
            payload: { stage: "ami_action", kind: "pool" },
            hangupCause: "AMI_ACTION_REJECTED",
          }).catch((registerErr) =>
            logger.error(
              { err: registerErr, target },
              "No se pudo terminalizar el intento rechazado por AMI"
            )
          );
        }
      }
      await callerIdsRecorded;
    } catch (err) {
      campaignFailures += 1;
      logger.error({ err, campaignId: cfg.campaign_id }, "Tick de campaña falló");
    }
  }

  return {
    ok: queueFailures === 0 && campaignFailures === 0,
    configuredCampaigns: configs.length,
    readyQueues: queueReadyCampaignIds.size,
    queueFailures,
    campaignFailures,
  };
}
