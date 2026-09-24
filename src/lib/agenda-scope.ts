import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Campaña cuya agenda ve el ejecutivo: la que eligió o le fijó su supervisor
 * (multiskill), o la única a la que pertenece. Un ejecutivo en Equifax no ve
 * sus agendas de Secretaria Virtual, igual que el discador no se las marca.
 *
 * null = no hay cómo saberlo (varias campañas y ninguna elegida) o la consulta
 * falló: se muestra todo, que es peor que filtrar pero mejor que esconder.
 */
export async function getMyAgendaCampaignId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_agenda_campaign_id");
  if (error || typeof data !== "string") return null;
  return data;
}
