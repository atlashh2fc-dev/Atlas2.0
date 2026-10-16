import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cotizador propio de la campaña (`campaigns.cotizador`), heredado de la madre
 * cuando la campaña es un canal hijo: Secretaria Virtual lo tiene por voz,
 * Inbound y WhatsApp. Equifax no pasa por acá: lo activan sus campos
 * comerciales en el flujo.
 */
export type CampaignCotizador = "secretaria_virtual";

export async function fetchCampaignCotizador(supabase: SupabaseClient, campaignId: string | null): Promise<CampaignCotizador | null> {
  if (!campaignId) return null;
  const { data } = await supabase.rpc("campaign_cotizador", { p_campaign_id: campaignId });
  return data === "secretaria_virtual" ? "secretaria_virtual" : null;
}
