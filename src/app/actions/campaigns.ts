"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

export async function createCampaign(formData: FormData) {
  await requireProfile(["admin"]);
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) throw new Error("El nombre de la campaña es obligatorio.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ name, description, created_by: user.id })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      redirect("/dashboard/admin/campanas?error=duplicate-name");
    }
    throw new Error(error.message);
  }
  revalidatePath("/dashboard/admin/campanas");
  redirect(`/dashboard/admin/campanas/${data.id}`);
}

export async function setCampaignWorkflow(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const workflowId = (formData.get("workflow_id") as string) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ workflow_id: workflowId, updated_at: new Date().toISOString() })
    .eq("id", campaignId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

export async function toggleCampaignActive(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({ is_active: !active, updated_at: new Date().toISOString() })
    .eq("id", campaignId);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/campanas");
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

export async function addCampaignAgent(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const profileId = formData.get("profile_id") as string;
  if (!profileId) throw new Error("Selecciona un ejecutivo.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_agents")
    .insert({ campaign_id: campaignId, profile_id: profileId });

  // Ignora duplicados (el ejecutivo ya estaba asignado).
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

export async function removeCampaignAgent(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const membershipId = formData.get("membership_id") as string;

  const supabase = await createClient();
  const { error } = await supabase.from("campaign_agents").delete().eq("id", membershipId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}
