import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { originatePersonalCallback } from "../ami/originatePersonalCallback";
import { forgetPersonalCallback, trackPersonalCallback } from "../ami/personalCallbacks";
import { holdAgentWhileBusy } from "./agentPause";
import { deliverAgendaBeforeQueue } from "./agendaBeforeQueue";
import { callerIdPool, pickCallerId, type CallerIdConfig } from "./callerId";
import {
  claimDuePersonalCallbacks,
  getAgentSessionStatuses,
  recordDialAttemptCallerIds,
  registerDialEvent,
  type DuePersonalCallback,
} from "../supabaseClient";

/** Lo que la entrega de agendas necesita de dialer_campaign_configs. */
export type CallbackCampaignConfig = CallerIdConfig & {
  campaign_id: string;
  dial_mode: string;
  trunk_context: string;
  personal_callback_enabled: boolean;
};

/**
 * Anota el número mostrado en cada intento sin frenar el discado: corre en
 * paralelo con los Originate y, si falla (o la migración aún no está), la
 * llamada sale igual y solo se pierde el dato para el informe por número.
 */
export function recordCallerIds(
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

/**
 * Origina las agendas ya reclamadas. Devuelve los ejecutivos a los que sí les
 * empezó a sonar la suya.
 */
export async function deliverPersonalCallbacks(
  ami: AmiClient,
  cfg: CallbackCampaignConfig,
  callbacks: DuePersonalCallback[]
): Promise<Set<string>> {
  const delivered = new Set<string>();
  if (callbacks.length === 0) return delivered;

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
    // Fuera de la cola antes de que le suene su agenda: si no, el
    // cliente que el predictivo marcó para otro le entraba encima.
    await holdAgentWhileBusy(ami, callback.agent_extension).catch((err) =>
      logger.warn(
        { err, extension: callback.agent_extension },
        "No se pudo pausar al ejecutivo antes de su agenda; el sync periódico lo cubre"
      )
    );
    try {
      await originatePersonalCallback({
        ami,
        target: callback,
        callerId: callbackCallerIds[index].callerId,
        trunkContext: cfg.trunk_context,
      });
      delivered.add(callback.agent_id);
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
  return delivered;
}

// Configuración de las campañas que leyó el último ciclo completo: la entrega
// antes de la cola ocurre fuera del ciclo y no vuelve a leerla.
const callbackCampaigns = new Map<string, CallbackCampaignConfig>();

export function rememberCallbackCampaigns(configs: readonly CallbackCampaignConfig[]): void {
  callbackCampaigns.clear();
  for (const cfg of configs) {
    // Igual que el ciclo: una campaña manual no recibe nada automático.
    if (cfg.dial_mode === "manual" || cfg.personal_callback_enabled === false) continue;
    callbackCampaigns.set(cfg.campaign_id, cfg);
  }
}

/**
 * Antes de devolver a un ejecutivo a la cola, le entrega su agenda vencida si
 * tiene una (ver agendaBeforeQueue.ts). true = no despausarlo: le está
 * sonando su agenda o la otra vía está decidiendo.
 */
export async function deliverDueAgendaBeforeQueue(ami: AmiClient, profileId: string): Promise<boolean> {
  if (callbackCampaigns.size === 0) return false;
  const sessions = await getAgentSessionStatuses(profileId);
  const campaignIds = sessions
    .filter((session) => session.status === "available" || session.status === "paused")
    .map((session) => session.campaign_id)
    .filter((campaignId) => callbackCampaigns.has(campaignId));
  if (campaignIds.length === 0) return false;

  return deliverAgendaBeforeQueue(
    profileId,
    campaignIds,
    async (campaignId) => {
      const cfg = callbackCampaigns.get(campaignId)!;
      const callbacks = await claimDuePersonalCallbacks(campaignId, 1, profileId);
      const delivered = await deliverPersonalCallbacks(ami, cfg, callbacks);
      if (delivered.has(profileId)) {
        logger.info({ profileId, campaignId }, "Agenda vencida entregada antes de devolver al ejecutivo a la cola");
        return true;
      }
      return false;
    },
    (err, campaignId) =>
      logger.error({ err, profileId, campaignId }, "No se pudo revisar la agenda antes de la cola; vuelve a la cola igual")
  );
}
