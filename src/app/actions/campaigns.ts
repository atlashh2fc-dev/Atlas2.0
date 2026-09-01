"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function atlasLeadIntegrationEndpoint(pathname: string): { url: URL; secret: string } {
  const baseUrl = process.env.ATLAS_LEAD_INTEGRATION_URL?.trim();
  const secret = process.env.INTEGRATION_DISPATCH_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero falta configurar la conexión segura con Atlas Lead. No se habilitó la exportación.",
    );
  }

  let url: URL;
  try {
    url = new URL(pathname, baseUrl);
  } catch {
    throw new Error("La URL de integración de Atlas Lead no es válida.");
  }
  const localDevelopment = process.env.NODE_ENV !== "production"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("La conexión con Atlas Lead debe usar HTTPS.");
  }
  if (secret.length < 32) {
    throw new Error("La conexión segura con Atlas Lead no está configurada correctamente.");
  }
  return { url, secret };
}

async function enableAtlasLeadCampaignExport(externalCampaignKey: string, campaignId: string) {
  const { url, secret } = atlasLeadIntegrationEndpoint("/api/integrations/outbox/campaign-readiness");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        campaignId: externalCampaignKey,
        crmCampaignId: campaignId,
        enabled: true,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero Atlas Lead no respondió. La exportación permanece pendiente.",
    );
  }

  const payload = await response.json().catch(() => null) as { acknowledged?: boolean; ready?: boolean } | null;
  if (!response.ok || payload?.acknowledged !== true || payload.ready !== true) {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero Atlas Lead no confirmó la habilitación. La exportación permanece pendiente.",
    );
  }
  return payload;
}

type AtlasLeadBackfillAck = {
  acknowledged?: boolean;
  complete?: boolean;
  hasMore?: boolean;
  batchesRun?: number;
  messagesScanned?: number;
  eventsPlanned?: number;
  deliveriesEnqueued?: number;
  remainingEvents?: number;
  remainingDeliveries?: number;
};

async function reconcileAtlasLeadCampaignHistory(externalCampaignKey: string): Promise<AtlasLeadBackfillAck> {
  const { url, secret } = atlasLeadIntegrationEndpoint("/api/integrations/outbox/backfill");
  url.searchParams.set("campaignId", externalCampaignKey);
  url.searchParams.set("dryRun", "false");
  url.searchParams.set("drain", "true");
  url.searchParams.set("limit", "5000");
  url.searchParams.set("maxBatches", "20");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new Error(
      "Atlas Lead quedó habilitado, pero la reconciliación histórica no respondió. Reintenta para continuar desde el último evento pendiente.",
    );
  }

  const payload = await response.json().catch(() => null) as AtlasLeadBackfillAck | null;
  if (!response.ok || payload?.acknowledged !== true) {
    throw new Error(
      "Atlas Lead quedó habilitado, pero no aceptó la reconciliación histórica. Reintenta para completar el vínculo.",
    );
  }
  if (payload.complete !== true || payload.hasMore === true) {
    throw new Error(
      "La reconciliación histórica avanzó, pero aún quedan eventos pendientes. Reintenta para continuar sin duplicar registros.",
    );
  }
  return payload;
}

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

export async function mapAtlasLeadMailCampaign(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = String(formData.get("campaign_id") ?? "").trim();
  const externalCampaignKey = String(formData.get("external_campaign_key") ?? "").trim();
  const name = String(formData.get("mail_campaign_name") ?? "").trim();
  const routingTeamId = String(formData.get("routing_team_id") ?? "").trim();

  if (!UUID.test(campaignId)) throw new Error("Campaña CRM inválida.");
  if (!UUID.test(externalCampaignKey)) {
    throw new Error("Ingresa el ID UUID de la campaña Atlas Lead.");
  }
  if (!name || name.length > 200) throw new Error("Ingresa el nombre de la campaña mail.");
  if (!UUID.test(routingTeamId)) throw new Error("Selecciona el equipo que recibirá las oportunidades mail.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("map_atlas_lead_mail_campaign", {
    p_external_campaign_key: externalCampaignKey,
    p_campaign_id: campaignId,
    p_name: name,
    p_status: "active",
    p_metadata: {
      mapped_from: "atlas_crm_admin",
      routing_team_id: routingTeamId,
    },
  });
  if (error) throw new Error(error.message);
  const result = data as { mapped?: boolean; readiness?: string } | null;
  if (!result?.mapped) throw new Error("CRM no pudo registrar el vínculo de campaña.");

  const readiness = await enableAtlasLeadCampaignExport(externalCampaignKey, campaignId);
  const backfill = await reconcileAtlasLeadCampaignHistory(externalCampaignKey);
  const { data: confirmation, error: confirmationError } = await supabase.rpc(
    "confirm_atlas_lead_mail_campaign_handshake",
    {
      p_external_campaign_key: externalCampaignKey,
      p_campaign_id: campaignId,
      p_readiness_metadata: {
        acknowledged: readiness.acknowledged === true,
        ready: readiness.ready === true,
        confirmed_via: "atlas_lead_readiness_api",
        history_outbox_complete: backfill.complete === true,
        history_batches: Number(backfill.batchesRun ?? 0),
        history_messages_scanned: Number(backfill.messagesScanned ?? 0),
        history_events_planned: Number(backfill.eventsPlanned ?? 0),
        history_deliveries_enqueued: Number(backfill.deliveriesEnqueued ?? 0),
        history_remaining_events: Number(backfill.remainingEvents ?? 0),
        history_remaining_deliveries: Number(backfill.remainingDeliveries ?? 0),
      },
    },
  );
  if (confirmationError) {
    throw new Error(
      "Atlas Lead confirmó la campaña, pero CRM no pudo cerrar el vínculo. Reintenta para reconciliarlo.",
    );
  }
  const confirmed = confirmation as { confirmed?: boolean; readiness?: string } | null;
  if (!confirmed?.confirmed || confirmed.readiness !== "ready") {
    throw new Error("CRM no confirmó que la integración esté lista.");
  }

  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
  revalidatePath(`/dashboard/campanas/${campaignId}`);
  revalidatePath(`/dashboard/mail?campaign=${campaignId}`);
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
