// Cierre automático de conexiones cortas.
//
// Medición del 25-09-2026 en Equifax: 261 de 830 conexiones del discador (31 %)
// duraron menos de 10 s —buzones, centralitas, gente que corta al tiro, con la
// detección de contestadora apagada— y la ejecutiva igual tipificaba cada una
// a mano (~110 s por conexión, 25,5 h de wrap-up contra 10,5 h hablando).
//
// La regla vive aquí, sin dependencias, para que la ficha, la acción del
// servidor y el administrador decidan lo mismo. El cierre reutiliza la
// tipificación anticipada: la ficha arma el motivo corto y se guarda sola al
// terminar la interrupción legal de 10 s, con las mismas validaciones.

import type { CallReasonConfig } from "@/lib/call-typification";

/** Tipo de evento en call_events que deja trazable cada cierre automático. */
export const SHORT_CALL_AUTO_CLOSED_EVENT = "call.short_call_auto_closed";

/** Rango aceptado para el umbral; la migración lo exige igual. */
export const SHORT_CALL_SECONDS_MIN = 1;
export const SHORT_CALL_SECONDS_MAX = 60;

export interface ShortCallConfig {
  thresholdSeconds: number;
  /** Valor de calls.reason del motivo que se aplica (CallReasonConfig.value). */
  disposition: string;
}

/**
 * Lo que la base sabe de la conexión de una gestión:
 * - `off`: la campaña no tiene umbral o motivo, o la llamada no vino del pool
 *   del discador (manual, agenda personal, voz IA).
 * - `live`: hubo puente con la ejecutiva pero el motor todavía no escribe el
 *   corte; la ficha vuelve a preguntar.
 * - `ended`: conexión terminada, con sus segundos de conversación.
 */
export type ShortCallFacts =
  | { state: "off" }
  | { state: "live" }
  | {
      state: "ended";
      talkSeconds: number;
      thresholdSeconds: number;
      disposition: string;
      dialAttemptId: string;
    };

/** Fila de dialer_campaign_configs; cualquiera de los dos en null apaga el cierre. */
export function readShortCallConfig(
  row: { short_call_seconds?: number | null; short_call_disposition?: string | null } | null | undefined
): ShortCallConfig | null {
  const seconds = row?.short_call_seconds;
  const disposition = row?.short_call_disposition?.trim();
  if (
    typeof seconds !== "number" ||
    !Number.isInteger(seconds) ||
    seconds < SHORT_CALL_SECONDS_MIN ||
    seconds > SHORT_CALL_SECONDS_MAX ||
    !disposition
  ) {
    return null;
  }
  return { thresholdSeconds: seconds, disposition };
}

/**
 * Segundos de conversación desde dial_attempts: bridged_at (el motor conecta
 * al cliente con la ejecutiva) hasta ended_at (cualquiera de los dos corta).
 * Se prefiere al TalkTime de la grabación porque existe en toda llamada del
 * discador aunque la grabación falle o llegue tarde, y lo escribe el mismo
 * evento de corte que libera a la ejecutiva: el 25-09 ambas fuentes difieren
 * menos de 3 s en las 874 conexiones de Equifax, pero 9 no tenían grabación.
 */
export function measureShortCall(
  config: ShortCallConfig | null,
  attempt: {
    id: string;
    attempt_kind: string | null;
    bridged_at: string | null;
    ended_at: string | null;
  } | null
): ShortCallFacts {
  // Una agenda personal es un compromiso del ejecutivo con su cliente: si
  // corta rápido, decide él. Solo se cierra solo el tráfico del pool.
  if (!config || !attempt || attempt.attempt_kind !== "pool" || !attempt.bridged_at) {
    return { state: "off" };
  }
  if (!attempt.ended_at) return { state: "live" };
  const talkMs = new Date(attempt.ended_at).getTime() - new Date(attempt.bridged_at).getTime();
  if (!Number.isFinite(talkMs)) return { state: "off" };
  return {
    state: "ended",
    talkSeconds: Math.max(0, talkMs / 1000),
    thresholdSeconds: config.thresholdSeconds,
    disposition: config.disposition,
    dialAttemptId: attempt.id,
  };
}

export function isShortConnection(talkSeconds: number, thresholdSeconds: number): boolean {
  return talkSeconds < thresholdSeconds;
}

/**
 * Un motivo sirve para cerrar sin la ejecutiva solo si no le pide nada más:
 * sin agenda, sin datos comerciales, sin nota obligatoria y sin venta. Con
 * cualquiera de esos, el cierre automático fallaría la validación.
 */
export function canAutoCloseWith(option: CallReasonConfig): boolean {
  return (
    option.agenda === "none" &&
    option.outcome !== "sale" &&
    option.requiresEquifaxData !== true &&
    option.notesRequiredWithoutAgenda !== true
  );
}

/** Opciones que el administrador puede elegir como motivo de conexión corta. */
export function shortCallDispositionOptions(catalog: CallReasonConfig[]): CallReasonConfig[] {
  const seen = new Set<string>();
  return catalog.filter((option) => {
    if (!canAutoCloseWith(option) || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

/**
 * Decide si la ficha arma sola el motivo corto. Lo que la ejecutiva ya hizo
 * manda: si armó una tipificación o eligió un motivo, no se toca nada.
 */
export function decideShortCallClosure(input: {
  facts: ShortCallFacts;
  catalog: CallReasonConfig[];
  armed: boolean;
  selectedReason: string | null;
}): { option: CallReasonConfig; talkSeconds: number } | null {
  const { facts, catalog, armed, selectedReason } = input;
  if (facts.state !== "ended") return null;
  if (armed || selectedReason) return null;
  if (!isShortConnection(facts.talkSeconds, facts.thresholdSeconds)) return null;
  const option = catalog.find((candidate) => candidate.value === facts.disposition);
  if (!option || !canAutoCloseWith(option)) return null;
  return { option, talkSeconds: facts.talkSeconds };
}

/**
 * El servidor vuelve a medir antes de marcar la gestión: la marca de auditoría
 * no depende de lo que diga el navegador.
 */
export function shortCallClosureQualifies(facts: ShortCallFacts, reason: string | null): boolean {
  return (
    facts.state === "ended" &&
    isShortConnection(facts.talkSeconds, facts.thresholdSeconds) &&
    reason === facts.disposition
  );
}

/** Segundos enteros hacia abajo: 9,6 s se muestra como 9 s, igual que se compara. */
export function formatShortCallSeconds(talkSeconds: number): number {
  return Math.max(0, Math.floor(talkSeconds));
}

export function shortCallNotice(talkSeconds: number, label: string): string {
  return `Conexión de ${formatShortCallSeconds(talkSeconds)} s: se cerrará como ${label}`;
}

/**
 * Valida los dos campos de Discado. Vacío apaga; un umbral sin motivo no se
 * acepta porque no habría con qué cerrar, y el motivo tiene que ser del
 * catálogo de la campaña y poder cerrarse sin la ejecutiva.
 */
export function parseShortCallSettings(
  rawSeconds: string | null | undefined,
  rawDisposition: string | null | undefined,
  catalog: CallReasonConfig[]
): { short_call_seconds: number | null; short_call_disposition: string | null } {
  const secondsText = (rawSeconds ?? "").trim();
  const disposition = (rawDisposition ?? "").trim() || null;
  let seconds: number | null = null;
  if (secondsText) {
    seconds = Number(secondsText);
    if (!Number.isInteger(seconds) || seconds < SHORT_CALL_SECONDS_MIN || seconds > SHORT_CALL_SECONDS_MAX) {
      throw new Error(
        `El umbral de conexión corta debe ser un entero entre ${SHORT_CALL_SECONDS_MIN} y ${SHORT_CALL_SECONDS_MAX} segundos, o quedar vacío.`
      );
    }
  }
  if (disposition && !shortCallDispositionOptions(catalog).some((option) => option.value === disposition)) {
    throw new Error("El motivo de conexión corta no está en el flujo de la campaña o pide agenda o datos.");
  }
  if (seconds !== null && !disposition) {
    throw new Error("Elige el motivo con que se cierran las conexiones cortas, o deja vacío el umbral.");
  }
  return { short_call_seconds: seconds, short_call_disposition: disposition };
}
