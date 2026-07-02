"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function assignMailEngagementLead(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);

  const leadId = String(formData.get("lead_id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  const mailCampaignId = String(formData.get("mail_campaign_id") ?? "");

  if (!leadId) throw new Error("Falta el lead a asignar.");
  if (!agentId) throw new Error("Selecciona un ejecutivo.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_reason: "Lead priorizado por apertura/click de mailing",
    p_source: "mail_engagement",
    p_set_managed_by: false,
    p_next_action_at: null,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/mail");
  if (mailCampaignId) revalidatePath(`/dashboard/mail?mailCampaign=${mailCampaignId}`);
}
