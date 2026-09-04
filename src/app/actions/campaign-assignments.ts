"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Reemplaza las campañas activas de un ejecutivo en una sola operación. */
export async function setAgentCampaigns(formData: FormData) {
  await requireProfile(["admin"]);
  const profileId = formData.get("profile_id") as string;
  const selectedCampaignIds = [...new Set(
    formData.getAll("campaign_ids").filter((value): value is string => typeof value === "string" && value.length > 0)
  )];
  if (!profileId) throw new Error("Ejecutivo inválido.");

  const supabase = await createClient();
  const [{ data: agent, error: agentError }, { data: activeCampaigns, error: campaignsError }] = await Promise.all([
    supabase.from("profiles").select("id").eq("id", profileId).eq("role", "agente").eq("active", true).maybeSingle(),
    supabase.from("campaigns").select("id").eq("is_active", true),
  ]);
  if (agentError) throw new Error(agentError.message);
  if (campaignsError) throw new Error(campaignsError.message);
  if (!agent) throw new Error("Solo se pueden configurar ejecutivos activos.");

  const activeCampaignIds = new Set((activeCampaigns ?? []).map((campaign) => campaign.id));
  if (selectedCampaignIds.some((id) => !activeCampaignIds.has(id))) {
    throw new Error("Una de las campañas seleccionadas ya no está activa.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("campaign_agents")
    .select("campaign_id")
    .eq("profile_id", profileId);
  if (existingError) throw new Error(existingError.message);

  // Solo tocamos campañas activas. Una membresía histórica/inactiva se conserva
  // para no perder su configuración si la campaña vuelve a habilitarse.
  const existingActiveIds = (existing ?? [])
    .map((membership) => membership.campaign_id)
    .filter((id) => activeCampaignIds.has(id));
  const selectedIds = new Set(selectedCampaignIds);
  const toAdd = selectedCampaignIds.filter((id) => !existingActiveIds.includes(id));
  const toRemove = existingActiveIds.filter((id) => !selectedIds.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("campaign_agents")
      .upsert(toAdd.map((campaignId) => ({ campaign_id: campaignId, profile_id: profileId, schedule_required: false })), {
        onConflict: "campaign_id,profile_id",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("campaign_agents")
      .delete()
      .eq("profile_id", profileId)
      .in("campaign_id", toRemove);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard/admin/usuarios");
  for (const campaignId of [...toAdd, ...toRemove]) {
    revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
  }
}
