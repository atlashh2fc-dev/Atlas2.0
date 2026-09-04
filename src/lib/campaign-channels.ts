import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "./types";

/**
 * Canales de atención habilitados por campaña (tabla `campaign_channels`).
 *
 * Hasta ahora el puesto de atención asumía WhatsApp para todos. En la operación
 * real 17 de las 18 campañas no tienen WhatsApp y sí tienen voz, así que el
 * ejecutivo entraba a una bandeja vacía. Lo que se atiende lo decide la
 * campaña, no la pantalla.
 */
export const CAMPAIGN_CHANNELS = ["phone", "whatsapp", "mail"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

const ATTENTION_CHANNEL_HREFS = {
  phone: "/dashboard/conversaciones/voz",
  whatsapp: "/dashboard/conversaciones/whatsapp",
  mail: "/dashboard/conversaciones/correo",
} satisfies Record<CampaignChannel, string>;

export const ATTENTION_TABS: { channel: CampaignChannel; label: string; href: string }[] = [
  { channel: "phone", label: "Voz", href: ATTENTION_CHANNEL_HREFS.phone },
  { channel: "whatsapp", label: "WhatsApp", href: ATTENTION_CHANNEL_HREFS.whatsapp },
  { channel: "mail", label: "Correo", href: ATTENTION_CHANNEL_HREFS.mail },
];

/**
 * Construye un deep link dentro del canal solicitado. Los filtros y la
 * conversación seleccionada nunca deben pasar por el índice genérico, porque
 * ese índice elige el primer canal habilitado y descarta el estado de la URL.
 */
export function attentionChannelHref(
  channel: CampaignChannel,
  params: Record<string, string | null | undefined> = {},
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  const query = search.toString();
  return `${ATTENTION_CHANNEL_HREFS[channel]}${query ? `?${query}` : ""}`;
}

export function isCampaignChannel(value: unknown): value is CampaignChannel {
  return typeof value === "string" && (CAMPAIGN_CHANNELS as readonly string[]).includes(value);
}

/**
 * Campañas dentro del alcance de la persona. El ejecutivo ve las suyas
 * (`campaign_agents`); supervisión y administración usan el mismo alcance que
 * ya gobierna sus reportes, para no inventar una segunda regla de visibilidad.
 */
async function scopedCampaignIds(
  supabase: SupabaseClient,
  profile: { id: string; role: AppRole }
): Promise<string[]> {
  if (profile.role === "agente") {
    const { data } = await supabase
      .from("campaign_agents")
      .select("campaign_id")
      .eq("profile_id", profile.id);
    return (data ?? []).map((row: { campaign_id: string }) => row.campaign_id);
  }

  const { data } = await supabase.rpc("get_report_scope_campaigns");
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/**
 * Canales habilitados en al menos una de las campañas del usuario, en el orden
 * en que se muestran las pestañas.
 */
export async function getEnabledChannels(
  supabase: SupabaseClient,
  profile: { id: string; role: AppRole }
): Promise<CampaignChannel[]> {
  const campaignIds = await scopedCampaignIds(supabase, profile);
  if (campaignIds.length === 0) return [];

  const { data } = await supabase
    .from("campaign_channels")
    .select("channel")
    .eq("enabled", true)
    .in("campaign_id", campaignIds);

  const enabled = new Set(
    (data ?? [])
      .map((row: { channel: string }) => row.channel)
      .filter(isCampaignChannel)
  );
  return CAMPAIGN_CHANNELS.filter((channel) => enabled.has(channel));
}

/**
 * Campañas del usuario que tienen un canal concreto habilitado. La cola de voz
 * y la bandeja de correo la usan para no mostrar registros de campañas que no
 * se atienden por ese canal.
 */
export async function getCampaignsWithChannel(
  supabase: SupabaseClient,
  profile: { id: string; role: AppRole },
  channel: CampaignChannel
): Promise<string[]> {
  const campaignIds = await scopedCampaignIds(supabase, profile);
  if (campaignIds.length === 0) return [];

  const { data } = await supabase
    .from("campaign_channels")
    .select("campaign_id")
    .eq("enabled", true)
    .eq("channel", channel)
    .in("campaign_id", campaignIds);

  return (data ?? []).map((row: { campaign_id: string }) => row.campaign_id);
}
