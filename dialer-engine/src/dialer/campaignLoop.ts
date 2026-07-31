import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { computeDialCapacity, computeEffectiveRatio } from "./pacing";
import { originateCall } from "../ami/originate";
import { originatePersonalCallback } from "../ami/originatePersonalCallback";
import { ensureQueue, syncQueueMembers } from "../asterisk/configSync";
import { syncAgentPauseStates } from "./agentPause";
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
  registerDialEvent,
} from "../supabaseClient";

const MAX_BATCH_PER_TICK = 10;
/** Entregas de compromisos por ciclo: van aparte del pacing del pool. */
const MAX_CALLBACKS_PER_TICK = 5;
const ABANDONMENT_WINDOW_MINUTES = 15;

type CampaignConfig = {
  campaign_id: string;
  dial_mode: string;
  max_dial_ratio: number;
  caller_id: string | null;
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
export async function runCampaignTick(ami: AmiClient, campaignIds: string[], queueToCampaignId: Map<string, string>) {
  if (campaignIds.length === 0) return;

  let configs: CampaignConfig[];
  try {
    configs = (await getActiveCampaignConfigs(campaignIds)) as CampaignConfig[];
  } catch (err) {
    logger.error({ err }, "No se pudo leer dialer_campaign_configs");
    return;
  }

  // Fase 1: dejar colas, miembros y pausas consistentes antes de originar.
  // Antes cada campaña agregaba miembros con Paused=false y podía marcar en
  // la ventana previa al sync de AUX.
  const queueReadyCampaignIds = new Set<string>();
  let queueMembershipChanged = false;
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
      logger.error({ err, campaignId: cfg.campaign_id }, "Sync de cola/extensiones falló");
    }
  }

  await syncAgentPauseStates(ami, { force: queueMembershipChanged });

  // Fase 2: pacing. Una campaña cuya cola no pudo reconciliarse no origina.
  for (const cfg of configs) {
    if (!queueReadyCampaignIds.has(cfg.campaign_id)) continue;

    // 'manual': la campaña existe solo para marcación manual desde la barra
    // CTI (o un botón "Llamar" en la ficha del lead) — el motor no debe
    // auto-discar ni consumir capacidad de agentes disponibles acá.
    if (cfg.dial_mode === "manual") continue;

    try {
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

      const [available, inFlight] = await Promise.all([
        countAvailableAgents(cfg.campaign_id),
        countInFlightAttempts(cfg.campaign_id),
      ]);

      // Solo en modo predictivo esto hace algo distinto de usar
      // max_dial_ratio tal cual — ver computeEffectiveRatio en pacing.ts.
      let effectiveRatio = cfg.max_dial_ratio;
      if (cfg.dial_mode === "predictive") {
        let measuredAbandonmentRate: number | null = null;
        try {
          measuredAbandonmentRate = await getRecentAbandonmentRate(cfg.campaign_id, ABANDONMENT_WINDOW_MINUTES);
        } catch (err) {
          logger.error({ err, campaignId: cfg.campaign_id }, "No se pudo medir abandono reciente; se usa el ratio anterior");
        }
        effectiveRatio = computeEffectiveRatio({
          campaignId: cfg.campaign_id,
          dialMode: cfg.dial_mode,
          baseRatio: cfg.max_dial_ratio,
          targetAbandonmentRate: cfg.target_abandonment_rate,
          measuredAbandonmentRate,
        });
        logger.info(
          { campaignId: cfg.campaign_id, measuredAbandonmentRate, effectiveRatio, targetAbandonmentRate: cfg.target_abandonment_rate },
          "Ratio predictivo ajustado"
        );
      }

      // Los compromisos agendados van PRIMERO y no consumen la capacidad del
      // pool: un cliente al que se le prometió una llamada a las 15:00 no
      // puede quedar detrás de la marcación masiva.
      if (cfg.personal_callback_enabled !== false) {
        try {
          const callbacks = await claimDuePersonalCallbacks(cfg.campaign_id, MAX_CALLBACKS_PER_TICK);
          for (const callback of callbacks) {
            try {
              await originatePersonalCallback({
                ami,
                target: callback,
                callerId: cfg.caller_id,
                trunkContext: cfg.trunk_context,
              });
            } catch (err) {
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
        { campaignId: cfg.campaign_id, available, inFlight, capacity, claimed: targets.length },
        "Originando lote de discado"
      );

      for (const target of targets) {
        try {
          await originateCall({
            ami,
            target,
            campaignId: cfg.campaign_id,
            queueName: cfg.queue_name,
            callerId: cfg.caller_id,
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
    } catch (err) {
      logger.error({ err, campaignId: cfg.campaign_id }, "Tick de campaña falló");
    }
  }
}
