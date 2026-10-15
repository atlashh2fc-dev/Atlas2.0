/**
 * Integridad en palabras.
 *
 * La pantalla mostraba columnas como «Contacto sin llamada» o «En ráfaga» y un
 * supervisor no sabía qué hacer con ellas. Cada caso se explica ahora con una
 * frase que dice qué no calza entre lo que tipificó el ejecutivo y lo que
 * registró la central.
 */

export type IntegrityCase = {
  motivo: "contacto_sin_conexion" | "cierre_rapido" | "rafaga";
  ultimo_intento: string | null;
  handle_seconds: number | null;
  seconds_since_previous: number | null;
};

/** Lo que marcó la central, dicho como lo diría un supervisor. */
const DIALER_RESULT: Record<string, string> = {
  no_answer: "no contestó",
  busy: "ocupado",
  failed: "la llamada no conectó",
  abandoned: "se cortó antes de conectar",
  voicemail: "buzón de voz",
  queued: "la llamada nunca salió",
  originating: "la llamada nunca salió",
  ringing: "sonó y nadie contestó",
};

export function formatSeconds(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

export function explainIntegrityCase(row: IntegrityCase): string {
  if (row.motivo === "contacto_sin_conexion") {
    if (!row.ultimo_intento) {
      return "Tipificó contacto, pero la central no registra ninguna llamada a este cliente.";
    }
    const result = DIALER_RESULT[row.ultimo_intento] ?? "sin conexión";
    return `Tipificó contacto, pero la central marcó: ${result}.`;
  }
  if (row.motivo === "cierre_rapido") {
    return `Cerró un contacto en ${formatSeconds(row.handle_seconds)}: no alcanza para una conversación.`;
  }
  return `Cerró ${formatSeconds(row.seconds_since_previous)} después de su gestión anterior.`;
}

/** Etiqueta corta del motivo, para la columna que se ordena y se exporta. */
export function integrityMotiveLabel(motivo: IntegrityCase["motivo"]): string {
  if (motivo === "contacto_sin_conexion") return "Contacto sin respaldo";
  if (motivo === "cierre_rapido") return "Contacto de segundos";
  return "Cierre en ráfaga";
}
