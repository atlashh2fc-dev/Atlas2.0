export type DialerAgentStatus =
  | "offline"
  | "available"
  | "ringing"
  | "on_call"
  | "paused";

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
