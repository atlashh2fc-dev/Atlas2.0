import { REPORT_TIME_ZONE } from "./report-range.ts";

/**
 * Celda de "Resultado por canal" convertida en filtro de Registros.
 *
 * La lista y el número salen de la misma función SQL
 * (`get_campaign_channel_leads`), así que abrir una celda muestra exactamente
 * los leads que cuenta. La campaña (madre) y el período viajan en la URL
 * porque las etapas dependen de ellos; la base no depende del período.
 *
 * La campaña va en `grupo` y no en `campaign`: el filtro de campaña de
 * Registros mira solo la campaña exacta y dejaría fuera a las hijas.
 */

export const CHANNEL_SEGMENT_CHANNELS = {
  saliente: "Llamada saliente",
  entrante: "Llamada entrante",
  whatsapp: "WhatsApp",
  correo: "Correo",
} as const;

export const CHANNEL_SEGMENT_STAGES = {
  base: "Base",
  gestionados: "Gestionados",
  contactados: "Contactados",
  interesados: "Interesados",
  ventas: "Ventas",
} as const;

export type ChannelSlug = keyof typeof CHANNEL_SEGMENT_CHANNELS;
export type ChannelName = (typeof CHANNEL_SEGMENT_CHANNELS)[ChannelSlug];
export type ChannelStage = keyof typeof CHANNEL_SEGMENT_STAGES;

export type ChannelSegment = {
  /** Campaña madre (o campaña suelta) cuyo desglose se abrió. */
  campaignId: string;
  /** Null = todos los canales (fila Total). */
  channel: ChannelSlug | null;
  stage: ChannelStage;
  from: string;
  to: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHANNEL_BY_NAME = new Map<string, ChannelSlug>(
  Object.entries(CHANNEL_SEGMENT_CHANNELS).map(([slug, name]) => [name, slug as ChannelSlug])
);

export function channelSlug(name: string): ChannelSlug | null {
  return CHANNEL_BY_NAME.get(name) ?? null;
}

export function channelSegmentHref(segment: ChannelSegment): string {
  const params = new URLSearchParams({
    grupo: segment.campaignId,
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
  grupo?: string;
  canal?: string;
  etapa?: string;
  desde?: string;
  hasta?: string;
}): ChannelSegment | null {
  const { grupo, canal, etapa } = params;
  if (!grupo || !UUID.test(grupo)) return null;
  if (!canal || !etapa || !(etapa in CHANNEL_SEGMENT_STAGES)) return null;
  const channel = canal === "todos" ? null : canal in CHANNEL_SEGMENT_CHANNELS ? (canal as ChannelSlug) : undefined;
  if (channel === undefined) return null;
  const from = validDate(params.desde);
  const to = validDate(params.hasta);
  if (!from || !to) return null;
  return { campaignId: grupo, channel, stage: etapa as ChannelStage, from, to };
}

export function channelSegmentLabel(segment: ChannelSegment, campaignName?: string | null): string {
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
  return [campaignName, channel, stage, period].filter(Boolean).join(" · ");
}
