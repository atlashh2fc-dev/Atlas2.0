/**
 * Bus mínimo para que el pacing reaccione a eventos en vez de esperar el
 * próximo tick: un ejecutivo que cerró su tipificación, un Originate que
 * falló en un segundo o un intento que terminó sin conversación liberan
 * capacidad ahora, y esperar hasta 3 s (más lo que dure el ciclo) por cada
 * uno era buena parte del tiempo muerto entre llamadas.
 *
 * server.ts registra el handler; el router de eventos AMI y la liberación
 * de ejecutivos sólo piden despertar. Si nadie registró handler (tests,
 * arranque), la petición se ignora.
 */
export type PacingWakeReason =
  | "agent_released"
  | "originate_failed"
  | "attempt_ended"
  | "manual";

type WakeHandler = (reason: PacingWakeReason, campaignId?: string) => void;

let handler: WakeHandler | null = null;

export function setPacingWakeHandler(next: WakeHandler | null): void {
  handler = next;
}

export function requestPacingWake(reason: PacingWakeReason, campaignId?: string): void {
  handler?.(reason, campaignId);
}
