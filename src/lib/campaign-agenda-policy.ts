import type { SupabaseClient } from "@supabase/supabase-js";
import { readAgendaPolicy, type AgendaPolicy } from "@/lib/call-typification";

/**
 * Franja de agendas de una campaña (campaigns.agenda_*, 20260924180100).
 *
 * Un error de lectura devuelve null en vez de romper la ficha: si el código
 * llega a producción antes que la migración, la columna todavía no existe y el
 * cierre no puede quedar bloqueado por eso. La base valida la misma franja al
 * guardar, así que esta lectura solo adelanta el aviso al ejecutivo.
 */
export async function fetchCampaignAgendaPolicy(
  supabase: SupabaseClient,
  campaignId: string | null | undefined
): Promise<AgendaPolicy | null> {
  if (!campaignId) return null;
  const { data, error } = await supabase
    .from("campaigns")
    .select("agenda_dias_habiles, agenda_hora_desde, agenda_hora_hasta")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) {
    console.warn("[campaign-agenda-policy] no se pudo leer la franja de agenda", {
      campaignId,
      error: error.message,
    });
    return null;
  }
  return readAgendaPolicy(data);
}
