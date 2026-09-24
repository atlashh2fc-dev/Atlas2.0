export type OriginateFailureEvent = "no_answer" | "busy" | "failed";

/**
 * Qué pasó con un Originate que no llegó a conectarse. OriginateResponse trae
 * en Reason el último estado de control del canal saliente:
 *
 * - 3 (RINGING): sonó hasta el timeout del Originate y nadie contestó. Es un
 *   no_answer: al cliente le sonó el teléfono. En producción eran ~730 intentos
 *   en 30 días marcados como 'failed', con mediana de 31 s de timbre.
 * - 5 (BUSY): ocupado.
 * - 8 (CONGESTION), 0 (el canal ni se creó) y cualquier otro: 'failed'. Sin
 *   originated_at, la base lo clasifica como falla técnica: espera corta y no
 *   gasta los intentos del cliente (dialer_attempt_result_class).
 *
 * En una agenda personal la pata que se origina es la del ejecutivo; ahí el
 * resultado habla del ejecutivo, no del cliente, y la base lo ignora para las
 * esperas porque no tiene originated_at.
 */
export function originateFailureEvent(reason: unknown): OriginateFailureEvent {
  const text = String(reason ?? "").trim();
  if (text === "") return "failed";
  const code = Number(text);
  if (code === 3) return "no_answer";
  if (code === 5) return "busy";
  return "failed";
}
