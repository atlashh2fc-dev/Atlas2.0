export type OriginateFailureEvent = "no_answer" | "busy" | "failed";

/**
 * Qué pasó con un Originate que no llegó a conectarse. OriginateResponse trae
 * en Reason el último estado de control del canal saliente:
 *
 * - 3 (RINGING): sonó hasta el timeout del Originate y nadie contestó. Es un
 *   no_answer: al cliente le sonó el teléfono. En producción eran ~730 intentos
 *   en 30 días marcados como 'failed', con mediana de 31 s de timbre.
 * - 5 (BUSY): ocupado.
 * - 8 (CONGESTION), 0 (el canal ni se creó) y cualquier otro: 'failed'.
 *
 * Con Reason 0 el carrier igual respondió algo, y esa respuesta llega en la
 * causa Q.850 del Hangup del canal (DIAL_ATTEMPT_ID viaja como channelvar del
 * AMI). Si está, manda la causa: 17 ocupado; 18/19/20 no contestó o está
 * apagado/fuera de cobertura (480). El resto sigue como 'failed' pero con la
 * causa guardada, y la base decide (dialer_attempt_result_class): 1/22/28 es
 * un número que no existe (404), 21 un rechazo del destino (403), 34/38/41/42/47
 * una falla de red. Sin causa, falla técnica como antes.
 *
 * En una agenda personal la pata que se origina es la del ejecutivo; ahí el
 * resultado habla del ejecutivo, no del cliente, y la base lo ignora para las
 * esperas porque no tiene originated_at.
 */
export function originateFailureEvent(reason: unknown, hangupCause?: unknown): OriginateFailureEvent {
  const text = String(reason ?? "").trim();
  const code = text === "" ? NaN : Number(text);
  if (code === 3) return "no_answer";
  if (code === 5) return "busy";

  const cause = Number(String(hangupCause ?? "").trim() || NaN);
  if (cause === 17) return "busy";
  if (cause === 18 || cause === 19 || cause === 20) return "no_answer";
  return "failed";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El DIAL_ATTEMPT_ID que el AMI adjunta a cada evento (manager.conf
 * channelvars). La librería asterisk-manager convierte las líneas
 * "ChanVariable: NOMBRE=valor" en un objeto { NOMBRE: valor }; se acepta
 * también el texto crudo por si cambia la librería.
 */
export function dialAttemptIdFromChanVariable(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      const candidate = String(value ?? "").trim();
      if (name.toUpperCase() === "DIAL_ATTEMPT_ID" && UUID.test(candidate)) return candidate.toLowerCase();
    }
    return undefined;
  }
  const values = Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    const match = /^DIAL_ATTEMPT_ID=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      String(value ?? "").trim()
    );
    if (match) return match[1].toLowerCase();
  }
  return undefined;
}
