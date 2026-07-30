"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type MailBulkAssignmentResult = { ok: number; skipped: number; error: string | null };

const MAIL_BULK_ASSIGNMENT_MAX = 100;

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

/**
 * Asigna una selección acotada de la consola Mail conservando el mismo evento
 * de asignación que usa la operación individual. El límite mantiene la acción
 * inmediata y evita convertir una decisión del supervisor en un proceso largo.
 */
export async function bulkAssignMailEngagementLeads(
  leadIds: string[],
  agentId: string
): Promise<MailBulkAssignmentResult> {
  await requireProfile(["supervisor", "admin"]);

  const ids = [...new Set(leadIds.filter(Boolean))].slice(0, MAIL_BULK_ASSIGNMENT_MAX);
  if (ids.length === 0) return { ok: 0, skipped: 0, error: "Selecciona al menos un lead." };
  if (!agentId) return { ok: 0, skipped: ids.length, error: "Selecciona un ejecutivo." };

  const supabase = await createClient();
  let ok = 0;

  for (const leadId of ids) {
    const { error } = await supabase.rpc("assign_lead", {
      p_lead_id: leadId,
      p_agent_id: agentId,
      p_reason: "Asignación masiva desde Bandeja mail",
      p_source: "mail_engagement.bulk_assign",
      p_set_managed_by: false,
      p_next_action_at: null,
    });

    if (error) return { ok, skipped: ids.length - ok, error: error.message };
    ok += 1;
  }

  // La consola, la ficha y la cola general leen el mismo responsable actual.
  revalidatePath("/dashboard/mail");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/team");

  return { ok, skipped: leadIds.length - ok, error: null };
}
