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

/**
 * Zona horaria de la operación.
 *
 * El período NO puede calcularse con los métodos locales de `Date`: el server
 * component corre en Vercel con el proceso en UTC, así que "hoy" arrancaba a
 * las 00:00 UTC — las 20:00 del día anterior en Chile— y el reporte de "Hoy"
 * mostraba media jornada de ayer. Tampoco sirve la zona del navegador: dos
 * personas mirando el mismo enlace verían cifras distintas.
 */
export const REPORT_TIME_ZONE = "America/Santiago";

type ZonedParts = { year: number; month: number; day: number };

function partsIn(date: Date, timeZone: string): ZonedParts & { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour12: false` puede devolver 24 en la medianoche de algunos entornos.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Desfase de la zona respecto de UTC para ese instante concreto. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = partsIn(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Instante exacto de una hora de pared en la zona de la operación.
 *
 * Se resuelve en dos pasadas porque Chile cambia de horario en septiembre y
 * abril: el desfase depende del instante que se está calculando.
 */
function instantFromZoned(
  { year, month, day }: ZonedParts,
  time: { hour: number; minute: number; second: number; ms: number }
): Date {
  const wallClock = Date.UTC(year, month - 1, day, time.hour, time.minute, time.second, time.ms);
  const firstGuess = wallClock - zoneOffsetMs(new Date(wallClock), REPORT_TIME_ZONE);
  const secondOffset = zoneOffsetMs(new Date(firstGuess), REPORT_TIME_ZONE);
  return new Date(wallClock - secondOffset);
}

function partsOf(date: Date): ZonedParts {
  const parts = partsIn(date, REPORT_TIME_ZONE);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function startOfDay(date: Date): Date {
  return instantFromZoned(partsOf(date), { hour: 0, minute: 0, second: 0, ms: 0 });
}

export function endOfDay(date: Date): Date {
  return instantFromZoned(partsOf(date), { hour: 23, minute: 59, second: 59, ms: 999 });
}

export function addDays(date: Date, days: number): Date {
  const { year, month, day } = partsOf(date);
  // El desplazamiento se hace sobre el día calendario y recién después se
  // resuelve el instante: sumar 24 h se equivoca en el cambio de horario.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return instantFromZoned(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    { hour: 0, minute: 0, second: 0, ms: 0 }
  );
}

/** `YYYY-MM-DD` del día en la zona de la operación. */
export function toDateInput(date: Date): string {
  const { year, month, day } = partsOf(date);
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

/** `YYYY-MM-DDTHH:mm` en la zona operativa, para inputs `datetime-local`. */
export function toDateTimeInput(date: Date): string {
  const { year, month, day, hour, minute } = partsIn(date, REPORT_TIME_ZONE);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** Interpreta un `datetime-local` como hora de pared de la operación chilena. */
export function parseDateTimeInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parsed = instantFromZoned(
    { year: Number(year), month: Number(month), day: Number(day) },
    { hour: Number(hour), minute: Number(minute), second: 0, ms: 0 }
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return toDateTimeInput(parsed) === value.trim() ? parsed : null;
}

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = instantFromZoned(
    { year: Number(year), month: Number(month), day: Number(day) },
    { hour: 0, minute: 0, second: 0, ms: 0 }
  );
  if (Number.isNaN(parsed.getTime())) return null;
  // Rechaza fechas imposibles (31 de febrero) que `Date` normalizaría en
  // silencio al mes siguiente.
  if (toDateInput(parsed) !== `${year}-${month}-${day}`) return null;
  return parsed;
}

/** Lunes como primer día: es la semana laboral con la que se mide la operación. */
function startOfWeek(date: Date): Date {
  const { year, month, day } = partsOf(date);
  // El día de la semana se toma del calendario de la zona, no del proceso.
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return addDays(startOfDay(date), -weekday);
}

function startOfMonth(date: Date): Date {
  const { year, month } = partsOf(date);
  return instantFromZoned({ year, month, day: 1 }, { hour: 0, minute: 0, second: 0, ms: 0 });
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
      const { year, month } = partsOf(thisMonth);
      const lastMonth =
        month === 1
          ? { year: year - 1, month: 12, day: 1 }
          : { year, month: month - 1, day: 1 };
      return {
        from: instantFromZoned(lastMonth, { hour: 0, minute: 0, second: 0, ms: 0 }),
        to: endOfDay(addDays(thisMonth, -1)),
      };
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

  // Redondeo, no truncamiento: en el cambio de horario un día dura 23 o 25 h.
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
    timeZone: REPORT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (range.preset !== "custom") {
    return `${REPORT_PRESET_LABELS[range.preset]} · ${formatter.format(range.from)} a ${formatter.format(range.to)}`;
  }
  return `${formatter.format(range.from)} a ${formatter.format(range.to)}`;
}
