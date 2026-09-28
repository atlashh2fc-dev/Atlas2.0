/**
 * Motivo con que se pausa en la cola a un ejecutivo que ya está ocupado con
 * otra gestión: una llamada manual (agenda rescatada, registro gestionado),
 * una agenda personal que le está sonando o una gestión sin cerrar.
 *
 * Sin esta pausa la cola le entregaba el cliente de otro ejecutivo encima de
 * su llamada: la base no podía abrirle una segunda gestión (una abierta por
 * ejecutivo) y el cliente quedaba hablando con alguien sin ficha.
 *
 * Es una pausa solo de Asterisk: el CRM no la ve como AUX y su sesión de
 * discado no cambia (ver isHeldForBusy en el router de eventos).
 */
export const BUSY_HOLD_REASON = "Atlas: gestión en curso";

/**
 * Qué pausa corresponde al ejecutivo. Cierre y AUX mandan sobre la
 * ocupación porque son estados que el CRM sí muestra.
 */
export function desiredPauseState(input: {
  inWrapUp: boolean;
  pauseReasonLabel: string | null;
  isPauseReason: boolean;
  busy: boolean;
}): { paused: boolean; reasonLabel: string | null; busyHold: boolean } {
  if (input.inWrapUp) return { paused: true, reasonLabel: "Cierre y tipificación", busyHold: false };
  if (input.isPauseReason) return { paused: true, reasonLabel: input.pauseReasonLabel, busyHold: false };
  if (input.busy) return { paused: true, reasonLabel: BUSY_HOLD_REASON, busyHold: true };
  return { paused: false, reasonLabel: input.pauseReasonLabel, busyHold: false };
}
