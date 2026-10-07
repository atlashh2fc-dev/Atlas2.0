import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { supabase, getAgentSessionStatuses, getBusyAgentIds, getStatusReason, isAgentInPauseReason } from "../supabaseClient";
import { getExtensionForProfileId } from "./agentDirectory";
import { holdAgentWhileBusy, pauseAgentForAux, resumeAgentAfterWrapUp } from "./agentPause";
import { requestPacingWake } from "./pacingWake";

/** Cuántas veces y cada cuánto se confirma que la sesión ya quedó 'available'. */
const SESSION_CONFIRM_ATTEMPTS = 6;
const SESSION_CONFIRM_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Liberación del ejecutivo por evento. Cuando Atlas cierra una gestión inserta
 * `call.closed` en call_events (tabla ya publicada por Realtime) y, acto
 * seguido, deja la sesión del discador en 'available'. Este módulo escucha
 * ese evento, confirma el estado en la base, despausa la extensión en
 * Asterisk en ese instante y despierta el pacing para que le marque ya.
 *
 * El ciclo periódico de syncAgentPauseStates sigue existiendo como respaldo:
 * si Realtime se cae o el evento llega antes de que la sesión cambie, nada
 * queda pausado para siempre — sólo vuelve a tardar lo de antes.
 */
export async function releaseAgentNow(ami: AmiClient, profileId: string): Promise<void> {
  const extension = getExtensionForProfileId(profileId);
  if (!extension) return;

  let availableCampaignId: string | undefined;
  for (let attempt = 0; attempt < SESSION_CONFIRM_ATTEMPTS; attempt += 1) {
    const sessions = await getAgentSessionStatuses(profileId);
    if (sessions.some((session) => session.status === "wrap_up")) {
      await sleep(SESSION_CONFIRM_DELAY_MS);
      continue;
    }
    availableCampaignId = sessions.find((session) => session.status === "available")?.campaign_id;
    break;
  }
  if (!availableCampaignId) {
    // Sigue en cierre (la ficha se cerró pero la sesión aún no cambió) o se
    // fue a pausa: el sync periódico decide.
    return;
  }
  if (await isAgentInPauseReason(profileId)) {
    // Eligió un motivo AUX durante la llamada: sigue pausado en Asterisk.
    return;
  }

  if ((await getBusyAgentIds([profileId])).has(profileId)) {
    // Cerró una gestión pero ya tomó otra (su agenda empezó a sonar o marcó
    // a mano): sigue fuera de la cola hasta que el sync lo vea libre.
    return;
  }

  if (!(await resumeAgentAfterWrapUp(ami, extension))) return;
  logger.info({ profileId, extension, campaignId: availableCampaignId }, "Ejecutivo liberado por evento; se despierta el pacing");
  requestPacingWake("agent_released", availableCampaignId);
}

export function subscribeAgentReleases(ami: AmiClient): () => Promise<void> {
  const channel = supabase
    .channel("dialer-engine-agent-release")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_events", filter: "event_type=eq.call.closed" },
      (payload) => {
        const row = payload.new as { agent_id?: string | null };
        const profileId = row?.agent_id;
        if (!profileId) return;
        releaseAgentNow(ami, profileId).catch((err) =>
          logger.error({ err, profileId }, "Liberación por evento falló; el sync periódico la cubre")
        );
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        logger.info("Suscrito a call.closed: liberación de ejecutivos por evento activa");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        logger.warn({ status, err }, "Suscripción Realtime de liberación de ejecutivos no disponible; rige el sync periódico");
      }
    });

  return async () => {
    await supabase.removeChannel(channel);
  };
}

/**
 * Gestiones que el ejecutivo abre por su cuenta desde Atlas (llamar una
 * agenda, un registro que gestionó o registrar una gestión fuera de línea).
 * Cada una inserta su evento en call_events en la misma transacción que la
 * llamada abierta.
 */
const MANUAL_MANAGEMENT_STARTED_EVENTS = [
  "cti.agenda_callback_started",
  "cti.assigned_lead_call_started",
  "cti.offline_management_started",
];

/**
 * Pausa en la cola al ejecutivo apenas abre una gestión manual, sin esperar
 * al sync periódico (5 s): en esa ventana el predictivo le entregaba el
 * cliente de otro encima de su llamada. Canal propio para que un problema
 * aquí no apague la liberación por call.closed.
 */
export function subscribeAgentHolds(ami: AmiClient): () => Promise<void> {
  let channel = supabase.channel("dialer-engine-agent-hold");
  for (const eventType of MANUAL_MANAGEMENT_STARTED_EVENTS) {
    channel = channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_events", filter: `event_type=eq.${eventType}` },
      (payload) => {
        const row = payload.new as { agent_id?: string | null };
        const profileId = row?.agent_id;
        if (!profileId) return;
        const extension = getExtensionForProfileId(profileId);
        if (!extension) return;
        holdAgentWhileBusy(ami, extension)
          .then(() => logger.info({ profileId, extension, eventType }, "Ejecutivo fuera de la cola mientras atiende su gestión manual"))
          .catch((err) =>
            logger.warn({ err, profileId, extension }, "No se pudo pausar al ejecutivo por su gestión manual; el sync periódico lo cubre")
          );
      }
    );
  }
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      logger.info("Suscrito a gestiones manuales: pausa por ocupación activa");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      logger.warn({ status, err }, "Suscripción Realtime de gestiones manuales no disponible; rige el sync periódico");
    }
  });

  return async () => {
    await supabase.removeChannel(channel);
  };
}

/** Los motivos casi no cambian; el heartbeat (cada 20 s) no consulta la base. */
const REASON_CACHE_MS = 5 * 60_000;
const reasonCache = new Map<string, { reason: { label: string; is_pause: boolean } | null; at: number }>();

async function cachedStatusReason(reasonId: string) {
  const hit = reasonCache.get(reasonId);
  if (hit && Date.now() - hit.at < REASON_CACHE_MS) return hit.reason;
  const reason = await getStatusReason(reasonId);
  reasonCache.set(reasonId, { reason, at: Date.now() });
  return reason;
}

/**
 * Pausa en la cola al ejecutivo apenas elige un AUX (o queda Desconectado),
 * sin esperar al sync periódico. Volver a Disponible sigue en manos del sync
 * y de la liberación por call.closed, que miran cierre y ocupación.
 */
export function subscribeAgentAuxPauses(ami: AmiClient): () => Promise<void> {
  const channel = supabase
    .channel("dialer-engine-agent-aux")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_current_status" },
      (payload) => {
        const row = payload.new as { profile_id?: string | null; reason_id?: string | null };
        const profileId = row?.profile_id;
        const reasonId = row?.reason_id;
        if (!profileId || !reasonId) return;
        const extension = getExtensionForProfileId(profileId);
        if (!extension) return;
        cachedStatusReason(reasonId)
          .then(async (reason) => {
            if (!reason?.is_pause) return;
            if (await pauseAgentForAux(ami, extension, reason.label)) {
              logger.info({ profileId, extension, reason: reason.label }, "Ejecutivo pausado en la cola al elegir AUX");
            }
          })
          .catch((err) =>
            logger.warn({ err, profileId, extension }, "No se pudo pausar al ejecutivo por su AUX; el sync periódico lo cubre")
          );
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        logger.info("Suscrito a agent_current_status: pausa por AUX inmediata activa");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        logger.warn({ status, err }, "Suscripción Realtime de AUX no disponible; rige el sync periódico");
      }
    });

  return async () => {
    await supabase.removeChannel(channel);
  };
}
