import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import {
  assignDialAttemptAgent,
  emitIncomingDialEvent,
  registerDialEvent,
  updateAgentDialerStatus,
} from "../supabaseClient";
import { getProfileIdForExtension } from "../dialer/agentDirectory";

// uniqueid del canal saliente (la pata que originamos) -> dial_attempt_id.
// Se puebla en OriginateResponse (ActionID = dial_attempt_id) y se limpia en Hangup.
const attemptByUniqueId = new Map<string, string>();

// dial_attempt_id -> si el cliente contestó y si llegó a bridgearse con un
// agente. Si contestó pero nunca hubo bridge antes del hangup, es un
// abandono real (el discador dejó a alguien esperando sin agente
// disponible) — el KPI más vigilado en marcado predictivo/asistido. Se
// limpia en Hangup junto con attemptByUniqueId.
const answerStateByAttemptId = new Map<string, { answered: boolean; bridged: boolean }>();

// dial_attempt_id de llamadas que AMD marcó como contestador/voicemail
// (evento UserEvent "AMDResult" con AMDStatus=MACHINE desde el contexto
// dialer-amd-out — ver configSync.ts). El Hangup normal que sigue no debe
// pisar este estado con "completed"/"failed" según la causa SIP: la razón
// real de que se cortó es que era una máquina, no que "alguien colgó tras
// contestar". Se limpia al procesar el Hangup, igual que los otros mapas.
const voicemailAttemptIds = new Set<string>();

function extensionFromInterface(iface: unknown): string | null {
  // AMI manda cosas como "PJSIP/1001" o "PJSIP/1001-00000012".
  if (typeof iface !== "string") return null;
  const match = iface.match(/\/(\d+)/);
  return match ? match[1] : null;
}

function attemptIdFromEvent(evt: Record<string, unknown>): string | undefined {
  for (const value of [
    evt.uniqueid,
    evt.linkedid,
    evt.bridgeduniqueid,
    evt.destuniqueid,
  ]) {
    const id = String(value ?? "");
    const attemptId = attemptByUniqueId.get(id);
    if (attemptId) return attemptId;
  }
  return undefined;
}

function hangupCauseToStatus(cause: unknown): "no_answer" | "busy" | "failed" | "completed" {
  const code = Number(cause);
  // Causas AQ.733 más comunes en troncales SIP.
  if (code === 17) return "busy";
  if (code === 19 || code === 18) return "no_answer";
  if (code === 16) return "completed"; // normal clearing (colgó alguien tras contestar)
  return "failed";
}

/**
 * Registra los listeners de AMI y traduce eventos crudos a las RPCs de
 * Supabase. Cualquier evento sin dial_attempt_id conocido se ignora (por
 * ejemplo, llamadas entrantes fuera del ciclo de discado outbound).
 */
export function registerEventRouter(ami: AmiClient, campaignIdByQueue: Map<string, string>) {
  ami.on("managerevent", (evt) => {
    const event = String(evt.event ?? "").toLowerCase();

    switch (event) {
      case "originateresponse": {
        const actionId = String(evt.actionid ?? "");
        const uniqueId = String(evt.uniqueid ?? "");
        if (!actionId || !uniqueId) return;
        attemptByUniqueId.set(uniqueId, actionId);

        const success = String(evt.response ?? "").toLowerCase() === "success";
        registerDialEvent({
          dialAttemptId: actionId,
          eventType: success ? "originating" : "failed",
          amiUniqueId: uniqueId,
          amiChannel: String(evt.channel ?? "") || null,
          payload: { raw_response: evt.response ?? null, reason: evt.reason ?? null },
        }).catch((err) => logger.error({ err, evt }, "register_dial_event (originate) falló"));
        return;
      }

      case "dialbegin": {
        const uniqueId = String(evt.uniqueid ?? "");
        const dialAttemptId = attemptByUniqueId.get(uniqueId);
        if (!dialAttemptId) return;
        registerDialEvent({ dialAttemptId, eventType: "ringing" }).catch((err) =>
          logger.error({ err, evt }, "register_dial_event (ringing) falló")
        );
        return;
      }

      case "dialend": {
        const uniqueId = String(evt.uniqueid ?? "");
        const dialAttemptId = attemptByUniqueId.get(uniqueId);
        if (!dialAttemptId) return;
        const status = String(evt.dialstatus ?? "").toUpperCase();
        if (status === "ANSWER") {
          const state = answerStateByAttemptId.get(dialAttemptId) ?? { answered: false, bridged: false };
          state.answered = true;
          answerStateByAttemptId.set(dialAttemptId, state);

          registerDialEvent({ dialAttemptId, eventType: "answered" }).catch((err) =>
            logger.error({ err, evt }, "register_dial_event (answered) falló")
          );
        }
        return;
      }

      case "agentconnect": {
        // El agente quedó bridgeado con la llamada saliente que dejamos en la Queue.
        const dialAttemptId = attemptIdFromEvent(evt);
        const extension = extensionFromInterface(evt.interface ?? evt.membername);
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!dialAttemptId) return;

        const state = answerStateByAttemptId.get(dialAttemptId) ?? { answered: false, bridged: false };
        state.bridged = true;
        answerStateByAttemptId.set(dialAttemptId, state);

        registerDialEvent({
          dialAttemptId,
          eventType: "bridged",
          agentId: profileId ?? null,
          payload: { queue: evt.queue ?? null, extension },
        }).catch((err) => logger.error({ err, evt }, "register_dial_event (bridged) falló"));

        const campaignId = campaignIdByQueue.get(String(evt.queue ?? ""));
        if (campaignId && extension && profileId) {
          updateAgentDialerStatus({
            profileId,
            campaignId,
            extension,
            status: "on_call",
          }).catch((err) =>
            logger.error({ err, evt }, "update_agent_dialer_status (on_call) falló")
          );
        }
        return;
      }

      case "agentcalled": {
        const dialAttemptId = attemptIdFromEvent(evt);
        const queue = String(evt.queue ?? "");
        const campaignId = campaignIdByQueue.get(queue);
        const extension = extensionFromInterface(
          evt.interface ?? evt.membername ?? evt.agentcalled ?? evt.destchannel
        );
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!dialAttemptId || !campaignId || !extension || !profileId) return;

        // Con estrategia `ringall` este evento llega una vez por cada miembro
        // timbrado: solo el primero se queda con el intento, para no abrir la
        // ficha del mismo cliente en la pantalla de todo el equipo.
        void (async () => {
          const claimed = await assignDialAttemptAgent(dialAttemptId, profileId).catch((err) => {
            logger.error({ err, evt }, "assign_dial_attempt_agent falló");
            return false;
          });
          if (!claimed) return;

          // Se ejecutan por separado: si el screen-pop falla, el estado del
          // ejecutivo igual tiene que quedar en "timbrando".
          const results = await Promise.allSettled([
            emitIncomingDialEvent(dialAttemptId, profileId),
            updateAgentDialerStatus({ profileId, campaignId, extension, status: "ringing" }),
          ]);
          for (const result of results) {
            if (result.status === "rejected") {
              logger.error({ err: result.reason, evt }, "efecto de AgentCalled falló");
            }
          }
        })();
        return;
      }

      case "agentcomplete": {
        const queue = String(evt.queue ?? "");
        const campaignId = campaignIdByQueue.get(queue);
        const extension = extensionFromInterface(evt.interface ?? evt.membername);
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!campaignId || !extension || !profileId) return;

        updateAgentDialerStatus({
          profileId,
          campaignId,
          extension,
          status: "wrap_up",
        }).catch((err) =>
          logger.error({ err, evt }, "update_agent_dialer_status (wrap_up) falló")
        );
        return;
      }

      case "hangup": {
        const uniqueId = String(evt.uniqueid ?? "");
        const dialAttemptId = attemptByUniqueId.get(uniqueId);
        if (!dialAttemptId) return;
        attemptByUniqueId.delete(uniqueId);

        const state = answerStateByAttemptId.get(dialAttemptId);
        answerStateByAttemptId.delete(dialAttemptId);

        const wasVoicemail = voicemailAttemptIds.delete(dialAttemptId);

        // Prioridad: AMD ya determinó que era contestador/voicemail (no es
        // ni abandono ni un no_answer/busy/failed real — es que el propio
        // motor cortó tras detectar la máquina). Si no, el cliente contestó
        // pero nunca llegó a bridgearse con un agente: abandono real del
        // discador, independiente de la causa SIP. Si no, la causa SIP
        // manda como siempre.
        const eventType = wasVoicemail
          ? "voicemail"
          : state?.answered && !state.bridged
            ? "abandoned"
            : hangupCauseToStatus(evt.cause);

        registerDialEvent({
          dialAttemptId,
          eventType,
          hangupCause: String(evt.cause ?? "") || null,
          payload: { cause_txt: evt["cause-txt"] ?? null },
        }).catch((err) => logger.error({ err, evt }, "register_dial_event (hangup) falló"));
        return;
      }

      case "userevent": {
        // UserEvent(AMDResult, AMDStatus: ..., DialAttemptId: ...) emitido
        // desde dialer-amd-out (configSync.ts) al terminar AMD(). El cliente
        // asterisk-manager expone el nombre del user event en minúsculas
        // como evt.userevent, y cada "Key: Value" del UserEvent como un
        // campo propio también en minúsculas (evt.amdstatus, evt.dialattemptid).
        const userEventName = String(evt.userevent ?? "").toLowerCase();
        if (userEventName !== "amdresult") return;

        const dialAttemptId = String(evt.dialattemptid ?? "");
        const amdStatus = String(evt.amdstatus ?? "").toUpperCase();
        if (!dialAttemptId) return;

        if (amdStatus === "MACHINE") {
          voicemailAttemptIds.add(dialAttemptId);
          logger.info({ dialAttemptId, amdStatus }, "AMD detectó contestador/voicemail");
        }
        return;
      }

      case "queuememberstatus":
      case "queuememberadded":
      case "queuememberpause": {
        const queue = String(evt.queue ?? "");
        const campaignId = campaignIdByQueue.get(queue);
        const extension = extensionFromInterface(evt.interface ?? evt.membername);
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!campaignId || !extension || !profileId) return;

        // Una pausa de cola NO es cierre de llamada. Marcarla como `wrap_up`
        // dejaba al ejecutivo atrapado: al volver de AUX el motor intentaba
        // ponerlo disponible, la guarda de wrap-up lo impedía y se quedaba sin
        // llamadas y con el selector bloqueado hasta tipificar algo.
        const paused = String(evt.paused ?? "0") === "1";
        const status = paused ? "paused" : "available";

        updateAgentDialerStatus({ profileId, campaignId, extension, status }).catch((err) =>
          logger.error({ err, evt }, "update_agent_dialer_status falló")
        );
        return;
      }

      default:
        return;
    }
  });
}
