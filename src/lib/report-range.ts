/**
 * Período analizado de los reportes.
 *
 * Antes cada pantalla resolvía su propia ventana: Gestión tenía 30 días fijos
 * en el server component y el Discador guardaba las fechas en estado local, así
 * que el rango se perdía al cambiar de pestaña y no se podía compartir un
 * enlace. La fuente de verdad ahora es la URL (`?preset=`, o `?from=&to=`), que
 * es lo que hace cualquier suite de contact center: el período es parte de la
 * vista, no del componente.
 */

export const REPORT_PRESETS = [
  "hoy",
  "ayer",
  "semana",
  "semana_pasada",
  "mes",
  "mes_pasado",
  "7d",
  "30d",
  "custom",
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const REPORT_PRESET_LABELS: Record<ReportPreset, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  semana: "Esta semana",
  semana_pasada: "Semana pasada",
  mes: "Este mes",
  mes_pasado: "Mes pasado",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  custom: "Personalizado",
};

export const DEFAULT_REPORT_PRESET: ReportPreset = "30d";

/**
 * Tope de seguridad. Las RPC de reportes recorren llamadas y eventos sin
 * paginar: un rango de años bloquearía la base para todos los demás.
 */
export const MAX_REPORT_RANGE_DAYS = 366;

export type ReportRange = {
  preset: ReportPreset;
  /** Inicio del período, inclusivo (00:00:00 local). */
  from: Date;
  /** Fin del período, inclusivo (23:59:59.999 local). */
  to: Date;
  /** Mismo largo, inmediatamente antes: es contra esto que se comparan los KPIs. */
  previousFrom: Date;
  previousTo: Date;
  /** Días calendario cubiertos, para rotular la comparación. */
  days: number;
  /** Aviso cuando la petición se corrigió (rango invertido, tope excedido). */
  notice: string | null;
};

export type ReportRangeParams = {
  preset?: string;
  from?: string;
  to?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function endOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

export function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

/** `YYYY-MM-DD` en hora local: `toISOString()` desplaza el día en Chile (UTC-3/-4). */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  // Construcción explícita en hora local; `new Date("2026-08-07")` es UTC.
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) return null;
  return parsed;
}

/** Lunes como primer día: es la semana laboral con la que se mide la operación. */
function startOfWeek(date: Date): Date {
  const value = startOfDay(date);
  const weekday = (value.getDay() + 6) % 7;
  return addDays(value, -weekday);
}

function startOfMonth(date: Date): Date {
  const value = startOfDay(date);
  value.setDate(1);
  return value;
}

function presetBounds(preset: ReportPreset, today: Date): { from: Date; to: Date } {
  switch (preset) {
    case "hoy":
      return { from: startOfDay(today), to: endOfDay(today) };
    case "ayer": {
      const yesterday = addDays(today, -1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case "semana":
      return { from: startOfWeek(today), to: endOfDay(today) };
    case "semana_pasada": {
      const lastWeekStart = addDays(startOfWeek(today), -7);
      return { from: lastWeekStart, to: endOfDay(addDays(lastWeekStart, 6)) };
    }
    case "mes":
      return { from: startOfMonth(today), to: endOfDay(today) };
    case "mes_pasado": {
      const thisMonth = startOfMonth(today);
      const lastMonth = new Date(thisMonth);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      return { from: lastMonth, to: endOfDay(addDays(thisMonth, -1)) };
    }
    case "7d":
      return { from: startOfDay(addDays(today, -6)), to: endOfDay(today) };
    case "30d":
    default:
      return { from: startOfDay(addDays(today, -29)), to: endOfDay(today) };
  }
}

function isPreset(value: string | undefined): value is ReportPreset {
  return !!value && (REPORT_PRESETS as readonly string[]).includes(value);
}

/**
 * Resuelve el período pedido en la URL. Nunca lanza: un parámetro corrupto o
 * manipulado a mano cae al preset por defecto con un aviso, en vez de dejar la
 * pantalla de reportes en error.
 */
export function resolveReportRange(
  params: ReportRangeParams,
  now: Date = new Date()
): ReportRange {
  const today = startOfDay(now);
  let notice: string | null = null;

  const requestedFrom = parseDateInput(params.from);
  const requestedTo = parseDateInput(params.to);
  const hasCustom = requestedFrom !== null && requestedTo !== null;

  let preset: ReportPreset = isPreset(params.preset)
    ? params.preset
    : hasCustom
      ? "custom"
      : DEFAULT_REPORT_PRESET;

  if (preset === "custom" && !hasCustom) {
    preset = DEFAULT_REPORT_PRESET;
    notice = "El rango personalizado estaba incompleto; se aplicó el período por defecto.";
  }

  let from: Date;
  let to: Date;

  if (preset === "custom" && requestedFrom && requestedTo) {
    from = startOfDay(requestedFrom);
    to = endOfDay(requestedTo);

    if (from.getTime() > to.getTime()) {
      // Invertir en vez de rechazar: es un error de tipeo, no un ataque.
      const swap = from;
      from = startOfDay(to);
      to = endOfDay(swap);
      notice = "Las fechas estaban invertidas y se corrigieron.";
    }

    const spanDays = Math.floor((endOfDay(to).getTime() - from.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_REPORT_RANGE_DAYS) {
      from = startOfDay(addDays(to, -(MAX_REPORT_RANGE_DAYS - 1)));
      notice = `El rango máximo es de ${MAX_REPORT_RANGE_DAYS} días; se recortó al tramo más reciente.`;
    }
  } else {
    const bounds = presetBounds(preset, today);
    from = bounds.from;
    to = bounds.to;
  }

  const days = Math.max(1, Math.round((endOfDay(to).getTime() - from.getTime()) / DAY_MS));
  // El comparativo es el tramo de igual duración que termina justo antes. Antes
  // se restaban 30 días siempre, así que cualquier otro rango comparaba contra
  // una ventana que no le correspondía.
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = startOfDay(addDays(from, -days));

  return { preset, from, to, previousFrom, previousTo, days, notice };
}

/** Conserva el resto de la query (campaña, filtros) al cambiar de período. */
export function reportRangeSearchParams(
  range: Pick<ReportRange, "preset" | "from" | "to">,
  base?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "");
  params.set("preset", range.preset);
  if (range.preset === "custom") {
    params.set("from", toDateInput(range.from));
    params.set("to", toDateInput(range.to));
  } else {
    params.delete("from");
    params.delete("to");
  }
  return params;
}

export function formatReportRangeLabel(range: ReportRange): string {
  const formatter = new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (range.preset !== "custom") {
    return `${REPORT_PRESET_LABELS[range.preset]} · ${formatter.format(range.from)} a ${formatter.format(range.to)}`;
  }
  return `${formatter.format(range.from)} a ${formatter.format(range.to)}`;
}
