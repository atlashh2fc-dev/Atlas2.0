import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import {
  confirmDialAttemptAgent,
  emitIncomingDialEvent,
  registerDialEvent,
  updateAgentDialerStatus,
} from "../supabaseClient";
import { getProfileIdForExtension } from "../dialer/agentDirectory";
import { pauseAgentForWrapUp } from "../dialer/agentPause";
import {
  normalizeAmiUniqueId,
  normalizeCallDisconnectParty,
  normalizeQueueTalkSeconds,
  queueMemberDialerStatus,
} from "./eventSemantics";
import type { RecordingCoordinator } from "../recording/types";
import { AttemptEventLifecycle } from "./eventLifecycle";

// uniqueid del canal saliente (la pata que originamos) -> dial_attempt_id.
// Se puebla en OriginateResponse (ActionID = dial_attempt_id) y se limpia en Hangup.
const attemptByUniqueId = new Map<string, string>();

// extensión del miembro de Queue -> intento actualmente bridgeado. Algunos
// Asterisk omiten Uniqueid/Linkedid en AgentComplete; la extensión sigue
// siendo inequívoca porque un agente sólo puede atender una llamada a la vez.
const attemptByAgentExtension = new Map<string, string>();

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

// AMI entrega los eventos en orden, pero las RPC anteriores se disparaban sin
// esperar unas por otras. Bajo latencia, Hangup podía confirmarse antes que
// Answered/AgentConnect y la transición terminal hacía que se perdieran el
// bridge y la llamada. Esta cola conserva el orden por intento sin serializar
// llamadas independientes.
const taskTailByAttemptId = new Map<string, Promise<unknown>>();
const attemptLifecycle = new AttemptEventLifecycle();
const correlationCleanupTimers = new Map<string, NodeJS.Timeout>();
const CORRELATION_CLEANUP_MS = 30_000;

function cleanupAttemptCorrelation(dialAttemptId: string): void {
  for (const [knownUniqueId, knownAttemptId] of attemptByUniqueId) {
    if (knownAttemptId === dialAttemptId) attemptByUniqueId.delete(knownUniqueId);
  }
  for (const [extension, knownAttemptId] of attemptByAgentExtension) {
    if (knownAttemptId === dialAttemptId) attemptByAgentExtension.delete(extension);
  }
  answerStateByAttemptId.delete(dialAttemptId);
  voicemailAttemptIds.delete(dialAttemptId);
  attemptLifecycle.clear(dialAttemptId);
  const timer = correlationCleanupTimers.get(dialAttemptId);
  if (timer) clearTimeout(timer);
  correlationCleanupTimers.delete(dialAttemptId);
}

function scheduleAttemptCorrelationCleanup(dialAttemptId: string): void {
  if (correlationCleanupTimers.has(dialAttemptId)) return;
  const timer = setTimeout(() => cleanupAttemptCorrelation(dialAttemptId), CORRELATION_CLEANUP_MS);
  timer.unref();
  correlationCleanupTimers.set(dialAttemptId, timer);
}

function enqueueAttemptTask(
  dialAttemptId: string,
  eventName: string,
  task: () => Promise<unknown>
): void {
  const previous = taskTailByAttemptId.get(dialAttemptId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .catch((err) => logger.error({ err, dialAttemptId }, `${eventName} falló`))
    .finally(() => {
      if (taskTailByAttemptId.get(dialAttemptId) === current) {
        taskTailByAttemptId.delete(dialAttemptId);
      }
    });
  taskTailByAttemptId.set(dialAttemptId, current);
}

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
    evt.destlinkedid,
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
export function registerEventRouter(
  ami: AmiClient,
  campaignIdByQueue: Map<string, string>,
  recording?: RecordingCoordinator
) {
  ami.on("managerevent", (evt) => {
    const event = String(evt.event ?? "").toLowerCase();

    switch (event) {
      case "originateresponse": {
        const actionId = String(evt.actionid ?? "");
        const uniqueId = normalizeAmiUniqueId(evt.uniqueid);
        if (!actionId) return;
        if (uniqueId) attemptByUniqueId.set(uniqueId, actionId);

        const success = String(evt.response ?? "").toLowerCase() === "success";
        enqueueAttemptTask(actionId, "register_dial_event (originate)", () =>
          registerDialEvent({
            dialAttemptId: actionId,
            eventType: success ? "originating" : "failed",
            amiUniqueId: uniqueId,
            amiChannel: String(evt.channel ?? "") || null,
            payload: { raw_response: evt.response ?? null, reason: evt.reason ?? null },
          })
        );
        return;
      }

      case "dialbegin": {
        const uniqueId = String(evt.uniqueid ?? "");
        const dialAttemptId = attemptByUniqueId.get(uniqueId);
        if (!dialAttemptId) return;
        enqueueAttemptTask(dialAttemptId, "register_dial_event (ringing)", () =>
          registerDialEvent({ dialAttemptId, eventType: "ringing" })
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

          enqueueAttemptTask(dialAttemptId, "register_dial_event (answered)", () =>
            registerDialEvent({ dialAttemptId, eventType: "answered" })
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
        if (extension) attemptByAgentExtension.set(extension, dialAttemptId);

        // Propaga la correlación a todas las patas informadas por Queue para
        // que AgentComplete/Hangup puedan detener la misma grabación.
        for (const value of [
          evt.uniqueid,
          evt.linkedid,
          evt.bridgeduniqueid,
          evt.destuniqueid,
          evt.destlinkedid,
        ]) {
          const id = String(value ?? "");
          if (id) attemptByUniqueId.set(id, dialAttemptId);
        }

        const state = answerStateByAttemptId.get(dialAttemptId) ?? { answered: false, bridged: false };
        state.bridged = true;
        answerStateByAttemptId.set(dialAttemptId, state);

        const campaignId = campaignIdByQueue.get(String(evt.queue ?? ""));
        if (extension && profileId) {
          enqueueAttemptTask(dialAttemptId, "confirmación de AgentConnect", async () => {
            const confirmed = await confirmDialAttemptAgent(dialAttemptId, profileId);
            if (!confirmed) {
              logger.warn({ dialAttemptId, profileId, extension }, "AgentConnect llegó para un intento no activo");
              return;
            }

            const callId = await registerDialEvent({
              dialAttemptId,
              eventType: "bridged",
              agentId: profileId,
              payload: { queue: evt.queue ?? null, extension },
            });

            const effects: Promise<unknown>[] = [emitIncomingDialEvent(dialAttemptId, profileId)];
            const channel = String(evt.channel ?? "");
            if (recording && callId && channel) {
              effects.push(
                recording.start({
                  dialAttemptId,
                  callId,
                  agentId: profileId,
                  campaignId,
                  channel,
                })
              );
            } else if (recording && (!callId || !channel)) {
              logger.error(
                { dialAttemptId, callId, channel },
                "No se inició grabación: AgentConnect sin call_id/canal"
              );
            }
            if (campaignId) {
              effects.push(
                updateAgentDialerStatus({
                  profileId,
                  campaignId,
                  extension,
                  status: "on_call",
                })
              );
            }
            const results = await Promise.allSettled(effects);
            for (const result of results) {
              if (result.status === "rejected") {
                logger.error({ err: result.reason, evt }, "efecto de AgentConnect falló");
              }
            }
          });
        }
        return;
      }

      case "agentcalled": {
        // AgentCalled sólo significa que el miembro fue notificado. No es
        // autoridad de propiedad: puede no responder o estar ya ocupado y la
        // Queue conectará a otra persona. Persistir aquí causaba que el primer
        // agente recibiera la tipificación de la llamada del segundo.
        return;
      }

      case "agentringnoanswer":
        // No se creó estado durable en AgentCalled, por lo que tampoco hay una
        // reserva provisional que liberar aquí.
        return;

      case "agentcomplete": {
        const extension = extensionFromInterface(evt.interface ?? evt.membername);
        const dialAttemptId =
          attemptIdFromEvent(evt) ??
          (extension ? attemptByAgentExtension.get(extension) : undefined);
        const disconnectParty = normalizeCallDisconnectParty(
          evt.reason ?? evt["disconnect-reason"]
        );
        const queueTalkSeconds = normalizeQueueTalkSeconds(
          evt.talktime ?? evt.talk_time ?? evt["talk-time"]
        );
        if (dialAttemptId && recording) {
          // Comparte la cola del AgentConnect: así la fila/grant de grabación
          // siempre existe antes de guardar Reason/TalkTime, incluso en
          // llamadas de pocos segundos.
          enqueueAttemptTask(dialAttemptId, "cierre de grabación en AgentComplete", () =>
            recording.stop(dialAttemptId, { disconnectParty, queueTalkSeconds })
          );
        }
        if (dialAttemptId) {
          const lifecycle = attemptLifecycle.registerAgentComplete(dialAttemptId);
          if (lifecycle.cleanup) cleanupAttemptCorrelation(dialAttemptId);
          else scheduleAttemptCorrelationCleanup(dialAttemptId);
        } else {
          logger.warn(
            {
              extension,
              queue: evt.queue ?? null,
              uniqueid: evt.uniqueid ?? null,
              linkedid: evt.linkedid ?? null,
            },
            "AgentComplete sin correlación; no se pudo guardar lado/TalkTime"
          );
        }
        const queue = String(evt.queue ?? "");
        const campaignId = campaignIdByQueue.get(queue);
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!campaignId || !extension || !profileId) return;

        void (async () => {
          // QueuePause es inmediato; el sync durable mantendrá la pausa hasta
          // que la tipificación cambie la sesión desde wrap_up a available.
          const results = await Promise.allSettled([
            pauseAgentForWrapUp(ami, extension),
            updateAgentDialerStatus({
              profileId,
              campaignId,
              extension,
              status: "wrap_up",
            }),
          ]);
          for (const result of results) {
            if (result.status === "rejected") {
              logger.error({ err: result.reason, evt }, "protección de wrap_up falló");
            }
          }
        })();
        return;
      }

      case "hangup": {
        const dialAttemptId = attemptIdFromEvent(evt);
        if (!dialAttemptId) return;
        // Ambas patas del bridge generan Hangup. Sólo la primera determina el
        // estado terminal; la correlación se conserva para un AgentComplete
        // tardío, que es quien informa qué lado terminó la conversación.
        const state = answerStateByAttemptId.get(dialAttemptId);
        const lifecycle = attemptLifecycle.registerHangup(dialAttemptId, state?.bridged === true);
        if (lifecycle.duplicate) return;
        if (recording) {
          void recording.stop(dialAttemptId).catch((err) =>
            logger.error({ err, dialAttemptId }, "StopMixMonitor de respaldo en Hangup falló")
          );
        }
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

        enqueueAttemptTask(dialAttemptId, "register_dial_event (hangup)", () =>
          registerDialEvent({
            dialAttemptId,
            eventType,
            hangupCause: String(evt.cause ?? "") || null,
            payload: { cause_txt: evt["cause-txt"] ?? null },
          })
        );
        if (lifecycle.cleanup) {
          cleanupAttemptCorrelation(dialAttemptId);
        } else {
          scheduleAttemptCorrelationCleanup(dialAttemptId);
        }
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
      case "queuememberpause":
      case "queuemember": {
        const queue = String(evt.queue ?? "");
        const campaignId = campaignIdByQueue.get(queue);
        const extension = extensionFromInterface(
          evt.interface ?? evt.location ?? evt.membername
        );
        const profileId = extension ? getProfileIdForExtension(extension) : undefined;
        if (!campaignId || !extension || !profileId) return;

        // Paused=0 no implica que el softphone esté registrado. Antes se
        // marcaba "available" incluso con Status=5 (Unavailable), generando
        // capacidad ficticia y clientes abandonados en una cola sin agente.
        const status = queueMemberDialerStatus(evt.paused, evt.status);
        if (!status) return;

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
