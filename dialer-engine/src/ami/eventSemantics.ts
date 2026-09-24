export type DialerAgentStatus =
  | "offline"
  | "available"
  | "ringing"
  | "on_call"
  | "paused";

export type CallDisconnectParty = "caller" | "agent" | "transfer";

const INVALID_AMI_UNIQUE_IDS = new Set(["", "unknown", "<unknown>", "null", "none"]);

/**
 * Asterisk usa literalmente "<unknown>" cuando un Originate falla antes de
 * crear un canal. Ese valor no identifica una llamada y nunca debe entrar al
 * mapa de correlación ni a la columna única dial_attempts.ami_unique_id.
 */
export function normalizeAmiUniqueId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return INVALID_AMI_UNIQUE_IDS.has(normalized.toLowerCase()) ? null : normalized;
}

/**
 * AgentComplete.Reason es la señal autoritativa de app_queue para saber qué
 * extremo terminó la conversación. No inferimos este dato desde Cause=16,
 * porque "normal clearing" puede provenir tanto del cliente como del agente.
 */
export function normalizeCallDisconnectParty(value: unknown): CallDisconnectParty | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "caller" || normalized === "agent" || normalized === "transfer"
    ? normalized
    : null;
}

export function normalizeQueueTalkSeconds(value: unknown): number | null {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * DeviceStatus de app_queue:
 * 0 unknown, 1 not in use, 2 in use, 3 busy, 4 invalid, 5 unavailable,
 * 6 ringing, 7 ringing+in use, 8 on hold.
 *
 * La pausa manda sobre el estado del dispositivo. Si el evento no trae
 * DeviceStatus, no inventamos disponibilidad: esperamos QueueStatus o el
 * siguiente QueueMemberStatus.
 */
export function queueMemberDialerStatus(
  pausedValue: unknown,
  deviceStatusValue: unknown
): DialerAgentStatus | null {
  if (String(pausedValue ?? "0") === "1") return "paused";

  const deviceStatus = Number(deviceStatusValue);
  switch (deviceStatus) {
    case 1:
      return "available";
    case 2:
    case 3:
    case 8:
      return "on_call";
    case 6:
    case 7:
      return "ringing";
    case 0:
    case 4:
    case 5:
      return "offline";
    default:
      return null;
  }
}

export type PersonalCallbackTerminalEvent = "completed" | "no_answer" | "busy" | "failed";

/**
 * Estado final de una agenda personal. En estas llamadas la pata que Atlas
 * origina es la del ejecutivo, así que la causa SIP del Hangup casi siempre es
 * 16 (el ejecutivo "colgó normal") aunque el cliente jamás haya contestado:
 * 79 intentos de Secretaria Virtual quedaron 'completed' en 7 s promedio sin
 * conversación. La verdad sobre el cliente está en DialEnd.DialStatus.
 *
 * - Con conversación: completed (el ejecutivo pasa a tipificar).
 * - NOANSWER o CANCEL (el ejecutivo desistió mientras sonaba): no_answer; al
 *   cliente sí le sonó, y eso cuenta para la cortesía de reintentos.
 * - BUSY: busy.
 * - Cualquier otra cosa, o si el Dial ni alcanzó a partir: failed.
 */
export function personalCallbackHangupEvent(params: {
  bridged: boolean;
  customerDialStatus: string | null | undefined;
}): PersonalCallbackTerminalEvent {
  if (params.bridged) return "completed";
  const status = String(params.customerDialStatus ?? "").trim().toUpperCase();
  if (status === "NOANSWER" || status === "CANCEL") return "no_answer";
  if (status === "BUSY") return "busy";
  return "failed";
}

/** Segundos de conversación desde que el cliente contestó, o null si no hubo. */
export function secondsSince(startMs: number | undefined, nowMs: number): number | null {
  if (startMs === undefined || !Number.isFinite(startMs) || nowMs < startMs) return null;
  return Math.round((nowMs - startMs) / 1000);
}
