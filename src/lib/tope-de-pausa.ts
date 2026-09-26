/**
 * Tope de las pausas (AUX): cuánto le queda a la ejecutiva o por cuánto se pasó.
 *
 * La medición del 25-09 en Equifax dio 40 % de la jornada en pausa y ningún
 * motivo tenía tope controlado: `agent_status_reasons.max_seconds` existía,
 * pero solo se mostraba como "tope sugerido" en la administración. La pausa no
 * se corta a la fuerza; se avisa a la ejecutiva y se resalta al supervisor.
 *
 * Sin dependencias de Next ni de Supabase: la usan el teléfono, el monitor en
 * vivo, la server action de administración y las pruebas.
 */

/** Rango que acepta la administración, en minutos. Ocho horas ya no es pausa. */
export const TOPE_MINIMO_MINUTOS = 1;
export const TOPE_MAXIMO_MINUTOS = 480;

export type EstadoDeTope =
  | { tipo: "sin_tope" }
  | { tipo: "dentro"; topeSegundos: number; transcurridoSegundos: number; restanteSegundos: number }
  | { tipo: "excedida"; topeSegundos: number; transcurridoSegundos: number; excesoSegundos: number };

/**
 * Compara el tiempo en la pausa actual contra su tope. Sin tope, sin fecha de
 * inicio válida o fuera de pausa no hay nada que controlar.
 */
export function estadoDeTope({
  since,
  maxSeconds,
  isPause,
  now,
}: {
  since: string | null | undefined;
  maxSeconds: number | null | undefined;
  isPause: boolean;
  now: number;
}): EstadoDeTope {
  if (!isPause || !since || maxSeconds == null || !Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    return { tipo: "sin_tope" };
  }
  const inicio = new Date(since).getTime();
  if (Number.isNaN(inicio)) return { tipo: "sin_tope" };
  // Un reloj del navegador atrasado no debe dar tiempo negativo.
  const transcurridoSegundos = Math.max(0, Math.floor((now - inicio) / 1000));
  if (transcurridoSegundos <= maxSeconds) {
    return {
      tipo: "dentro",
      topeSegundos: maxSeconds,
      transcurridoSegundos,
      restanteSegundos: maxSeconds - transcurridoSegundos,
    };
  }
  return {
    tipo: "excedida",
    topeSegundos: maxSeconds,
    transcurridoSegundos,
    excesoSegundos: transcurridoSegundos - maxSeconds,
  };
}

/**
 * Minutos legibles: "10 min", "1 h", "1 h 15 min". Redondea hacia arriba para
 * que un exceso de 20 segundos se lea "1 min" y no "0 min", que suena a nada.
 */
export function formatearMinutos(segundos: number): string {
  const minutos = Math.max(1, Math.ceil(segundos / 60));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** Cuenta regresiva mm:ss (o h:mm:ss) para lo que le queda de pausa. */
export function formatearRestante(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  return horas > 0
    ? `${horas}:${String(minutos).padStart(2, "0")}:${String(resto).padStart(2, "0")}`
    : `${String(minutos).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

/** Aviso a la ejecutiva, de tú: "Te pasaste 3 min de tu pausa de 10 min". */
export function avisoParaEjecutiva(estado: EstadoDeTope): string | null {
  if (estado.tipo !== "excedida") return null;
  return `Te pasaste ${formatearMinutos(estado.excesoSegundos)} de tu pausa de ${formatearMinutos(estado.topeSegundos)}`;
}

/** Texto del monitor: "excedida por 3 min". */
export function avisoParaSupervisor(estado: EstadoDeTope): string | null {
  if (estado.tipo !== "excedida") return null;
  return `excedida por ${formatearMinutos(estado.excesoSegundos)}`;
}

/**
 * Valida el tope que escribe el admin, en minutos enteros. Vacío significa
 * "sin tope" y es válido: hay pausas (una reunión larga, una capacitación)
 * que la empresa puede decidir no controlar.
 */
export function validarTopeEnMinutos(
  valor: unknown
): { ok: true; segundos: number | null } | { ok: false; error: string } {
  const texto = typeof valor === "string" ? valor.trim().replace(",", ".") : "";
  if (texto === "") return { ok: true, segundos: null };
  if (!/^\d+$/.test(texto)) {
    return { ok: false, error: "El tope va en minutos enteros, sin decimales." };
  }
  const minutos = Number(texto);
  if (minutos < TOPE_MINIMO_MINUTOS || minutos > TOPE_MAXIMO_MINUTOS) {
    return {
      ok: false,
      error: `El tope debe estar entre ${TOPE_MINIMO_MINUTOS} y ${TOPE_MAXIMO_MINUTOS} minutos, o vacío para no tener tope.`,
    };
  }
  return { ok: true, segundos: minutos * 60 };
}
