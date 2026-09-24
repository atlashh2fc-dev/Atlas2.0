import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { supabase, getAgentSessionStatuses, isAgentInPauseReason } from "../supabaseClient";
import { getExtensionForProfileId } from "./agentDirectory";
import { resumeAgentAfterWrapUp } from "./agentPause";
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

  await resumeAgentAfterWrapUp(ami, extension);
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
