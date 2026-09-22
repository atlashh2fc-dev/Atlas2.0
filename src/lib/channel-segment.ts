import { REPORT_TIME_ZONE } from "./report-range.ts";

/**
 * Celda de "Resultado por canal de origen" convertida en filtro de Registros.
 *
 * La lista y el número salen de la misma función SQL
 * (`get_secretaria_virtual_channel_leads`), así que abrir una celda muestra
 * exactamente los leads que cuenta. El período viaja en la URL porque
 * contactados, interesados y ventas dependen de él; la base no.
 */

export const CHANNEL_SEGMENT_CHANNELS = {
  mail: "Mail",
  whatsapp: "WhatsApp",
  llamada: "Llamada / base",
} as const;

export const CHANNEL_SEGMENT_STAGES = {
  base: "Base",
  contactados: "Contactados",
  interesados: "Interesados",
  ventas: "Ventas",
} as const;

export type ChannelSlug = keyof typeof CHANNEL_SEGMENT_CHANNELS;
export type ChannelName = (typeof CHANNEL_SEGMENT_CHANNELS)[ChannelSlug];
export type ChannelStage = keyof typeof CHANNEL_SEGMENT_STAGES;

export type ChannelSegment = {
  /** Null = todos los canales (fila Total). */
  channel: ChannelSlug | null;
  stage: ChannelStage;
  from: string;
  to: string;
};

const CHANNEL_BY_NAME = new Map<string, ChannelSlug>(
  Object.entries(CHANNEL_SEGMENT_CHANNELS).map(([slug, name]) => [name, slug as ChannelSlug])
);

export function channelSlug(name: string): ChannelSlug | null {
  return CHANNEL_BY_NAME.get(name) ?? null;
}

export function channelSegmentHref(segment: ChannelSegment): string {
  const params = new URLSearchParams({
    canal: segment.channel ?? "todos",
    etapa: segment.stage,
    desde: segment.from,
    hasta: segment.to,
  });
  return `/dashboard/leads?${params.toString()}`;
}

function validDate(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function parseChannelSegment(params: {
  canal?: string;
  etapa?: string;
  desde?: string;
  hasta?: string;
}): ChannelSegment | null {
  const { canal, etapa } = params;
  if (!canal || !etapa || !(etapa in CHANNEL_SEGMENT_STAGES)) return null;
  const channel = canal === "todos" ? null : canal in CHANNEL_SEGMENT_CHANNELS ? (canal as ChannelSlug) : undefined;
  if (channel === undefined) return null;
  const from = validDate(params.desde);
  const to = validDate(params.hasta);
  if (!from || !to) return null;
  return { channel, stage: etapa as ChannelStage, from, to };
}

export function channelSegmentLabel(segment: ChannelSegment): string {
  const formatter = new Intl.DateTimeFormat("es-CL", {
    timeZone: REPORT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const channel = segment.channel ? CHANNEL_SEGMENT_CHANNELS[segment.channel] : "Todos los canales";
  const stage = CHANNEL_SEGMENT_STAGES[segment.stage];
  const period =
    segment.stage === "base"
      ? "toda la base del canal"
      : `${formatter.format(new Date(segment.from))} a ${formatter.format(new Date(segment.to))}`;
  return `${channel} · ${stage} · ${period}`;
}
