"use server";

import { requireProfile } from "@/lib/auth";
import { normalizeChilePhone } from "@/lib/chile-phone";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const AGENT_ID_PATTERN = /^agent_[A-Za-z0-9]+$/;

function campaignPath(campaignId: string): string {
  return `/dashboard/admin/campanas/${campaignId}`;
}

export async function upsertAiVoiceCampaignConfig(formData: FormData) {
  await requireProfile(["admin"]);

  const campaignId = String(formData.get("campaign_id") ?? "").trim();
  const agentId = String(formData.get("agent_id") ?? "").trim();
  const phoneNumberId = String(formData.get("phone_number_id") ?? "").trim() || null;
  const maxConcurrentCalls = Number(formData.get("max_concurrent_calls"));
  const maxAttemptsPerContact = Number(formData.get("max_attempts_per_contact"));
  const isActive = formData.get("is_active") === "true";

  if (!campaignId) throw new Error("Falta la campaña.");
  if (!AGENT_ID_PATTERN.test(agentId)) throw new Error("El ID del agente ElevenLabs no es válido.");
  if (!Number.isInteger(maxConcurrentCalls) || maxConcurrentCalls < 1 || maxConcurrentCalls > 10) {
    throw new Error("La concurrencia debe estar entre 1 y 10.");
  }
  if (!Number.isInteger(maxAttemptsPerContact) || maxAttemptsPerContact < 1 || maxAttemptsPerContact > 5) {
    throw new Error("Los intentos por contacto deben estar entre 1 y 5.");
  }
  if (isActive && !phoneNumberId) {
    throw new Error("Importa y selecciona el troncal SIP de ElevenLabs antes de iniciar la campaña.");
  }

  const supabase = await createClient();
  const [{ data: humanDialer }, { count: memberCount }, { data: campaign }] = await Promise.all([
    supabase.from("dialer_campaign_configs").select("campaign_id").eq("campaign_id", campaignId).maybeSingle(),
    supabase.from("campaign_agents").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId),
    supabase.from("campaigns").select("is_active").eq("id", campaignId).single(),
  ]);

  if (humanDialer) throw new Error("Esta campaña ya usa el discador de ejecutivos.");
  if ((memberCount ?? 0) > 0) throw new Error("Retira los ejecutivos: una campaña IA no puede tener personas asignadas.");
  if (isActive && !campaign?.is_active) throw new Error("Habilita primero la campaña general.");

  const { error } = await supabase.from("ai_voice_campaign_configs").upsert({
    campaign_id: campaignId,
    provider: "elevenlabs",
    agent_id: agentId,
    phone_number_id: phoneNumberId,
    max_concurrent_calls: maxConcurrentCalls,
    max_attempts_per_contact: maxAttemptsPerContact,
    is_active: isActive,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/campanas");
  revalidatePath(campaignPath(campaignId));
  revalidatePath(`${campaignPath(campaignId)}/ia`);
}

export async function requestAiVoiceTestCall(formData: FormData) {
  const admin = await requireProfile(["admin"]);

  const campaignId = String(formData.get("campaign_id") ?? "").trim();
  const rawContactName = String(formData.get("contact_name") ?? "").trim();
  const contactName = rawContactName || "Prueba";
  const phone = normalizeChilePhone(String(formData.get("phone") ?? ""));

  if (!campaignId) throw new Error("Falta la campaña.");
  if (contactName.length > 120) throw new Error("El nombre no puede superar 120 caracteres.");

  const supabase = await createClient();
  const { data: config, error: configError } = await supabase
    .from("ai_voice_campaign_configs")
    .select("phone_number_id,campaigns(is_active)")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (configError) throw new Error(configError.message);
  if (!config) throw new Error("Configura primero el agente de voz de esta campaña.");
  if (!config.phone_number_id) throw new Error("Falta conectar el número / troncal SIP de ElevenLabs.");

  const relatedCampaign = config.campaigns as unknown;
  const campaign = Array.isArray(relatedCampaign)
    ? (relatedCampaign[0] as { is_active: boolean } | undefined) ?? null
    : (relatedCampaign as { is_active: boolean } | null);
  if (!campaign?.is_active) throw new Error("La campaña general debe estar habilitada para realizar una prueba.");

  const { error } = await supabase.from("ai_voice_test_calls").insert({
    campaign_id: campaignId,
    requested_by: admin.id,
    contact_name: contactName,
    phone,
  });

  if (error?.code === "23505") {
    throw new Error("Ese número ya tiene una prueba pendiente o en curso.");
  }
  if (error) throw new Error(error.message);

  revalidatePath(`${campaignPath(campaignId)}/ia`);
}
