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
  const profileIds = [...new Set(
    [...formData.getAll("profile_ids"), formData.get("profile_id")]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  )];
  if (profileIds.length === 0) throw new Error("Selecciona al menos un ejecutivo.");

  const supabase = await createClient();
  const { data: validAgents, error: agentsError } = await supabase
    .from("profiles")
    .select("id")
    .in("id", profileIds)
    .eq("role", "agente")
    .eq("active", true);
  if (agentsError) throw new Error(agentsError.message);
  if ((validAgents ?? []).length !== profileIds.length) {
    throw new Error("Solo se pueden asignar ejecutivos activos.");
  }

  const { error } = await supabase
    .from("campaign_agents")
    .upsert(
      profileIds.map((profileId) => ({ campaign_id: campaignId, profile_id: profileId, schedule_required: true })),
      { onConflict: "campaign_id,profile_id", ignoreDuplicates: true }
    );

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function removeCampaignAgent(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const membershipId = formData.get("membership_id") as string;

  const supabase = await createClient();
  const { error } = await supabase.from("campaign_agents").delete().eq("id", membershipId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
  revalidatePath("/dashboard/admin/usuarios");
}

export async function setCampaignAgentManualDial(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const membershipId = formData.get("membership_id") as string;
  const enabled = formData.get("enabled") === "true";
  if (!campaignId || !membershipId) throw new Error("Asignación inválida.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_agents")
    .update({ manual_dial_enabled: enabled })
    .eq("id", membershipId)
    .eq("campaign_id", campaignId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}/ejecutivos`);
}

export async function setCampaignManualDialForAll(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const enabled = formData.get("enabled") === "true";
  if (!campaignId) throw new Error("Campaña inválida.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaign_agents")
    .update({ manual_dial_enabled: enabled })
    .eq("campaign_id", campaignId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}/ejecutivos`);
}

export async function addCampaignAgentSchedule(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const membershipId = formData.get("membership_id") as string;
  const startTime = formData.get("start_time") as string;
  const endTime = formData.get("end_time") as string;
  const daysOfWeek = [...new Set(
    formData
      .getAll("days_of_week")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
  )];

  if (!membershipId || daysOfWeek.length === 0 || !startTime || !endTime) {
    throw new Error("Selecciona días y define el horario de conexión.");
  }
  if (startTime >= endTime) {
    throw new Error("El fin del horario debe ser posterior al inicio.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaign_agent_schedules").insert({
    campaign_agent_id: membershipId,
    days_of_week: daysOfWeek,
    start_time: startTime,
    end_time: endTime,
    timezone: "America/Santiago",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

export async function removeCampaignAgentSchedule(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  const scheduleId = formData.get("schedule_id") as string;
  if (!scheduleId) throw new Error("Horario inválido.");

  const supabase = await createClient();
  const { error } = await supabase.from("campaign_agent_schedules").delete().eq("id", scheduleId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}
