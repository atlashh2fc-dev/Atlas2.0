"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import {
  deleteAbogadoLegalEmails,
  syncAbogadoLegalInbox,
  type InboundDeleteResult,
  type InboundSyncResult,
} from "@/lib/inbound-mail";
import { createClient } from "@/lib/supabase/server";

export type MailBulkAssignmentResult = { ok: number; skipped: number; error: string | null };

const MAIL_BULK_ASSIGNMENT_MAX = 100;

export type InboundConversionResult = {
  ok: boolean;
  leadId?: string;
  error?: string;
};

export async function syncInboundMailbox(): Promise<InboundSyncResult> {
  await requireProfile(["supervisor", "admin"]);
  const result = await syncAbogadoLegalInbox();
  revalidatePath("/dashboard/correo-abogado-legal");
  return result;
}

export async function deleteInboundEmails(emailIds: string[]): Promise<InboundDeleteResult> {
  await requireProfile(["supervisor", "admin"]);
  const result = await deleteAbogadoLegalEmails(emailIds);
  revalidatePath("/dashboard/correo-abogado-legal");
  return result;
}

export async function convertInboundEmail(
  emailId: string,
  agentId: string,
  phone: string,
  fullName: string
): Promise<InboundConversionResult> {
  await requireProfile(["supervisor", "admin"]);
  if (!emailId) return { ok: false, error: "Falta seleccionar el correo." };
  if (!agentId) return { ok: false, error: "Selecciona un ejecutivo." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_inbound_email_to_lead", {
    p_email_id: emailId,
    p_agent_id: agentId,
    p_phone: phone.trim() || null,
    p_full_name: fullName.trim() || null,
  });

  if (error) return { ok: false, error: error.message };
  const payload = data as { lead_id?: string } | null;
  revalidatePath("/dashboard/correo-abogado-legal");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/team");
  return { ok: true, leadId: payload?.lead_id };
}

export async function assignMailEngagementLead(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);

  const leadId = String(formData.get("lead_id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  const mailCampaignId = String(formData.get("mail_campaign_id") ?? "");

  if (!leadId) throw new Error("Falta el lead a asignar.");
  if (!agentId) throw new Error("Selecciona un ejecutivo.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_mail_engagement_opportunities", {
    p_lead_ids: [leadId],
    p_agent_id: agentId,
    p_mail_campaign_id: mailCampaignId || null,
    p_campaign_id: null,
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

  const ids = [...new Set(leadIds.filter(Boolean))];
  if (ids.length === 0) return { ok: 0, skipped: 0, error: "Selecciona al menos un lead." };
  if (ids.length > MAIL_BULK_ASSIGNMENT_MAX) {
    return {
      ok: 0,
      skipped: ids.length,
      error: `Puedes asignar hasta ${MAIL_BULK_ASSIGNMENT_MAX} oportunidades por operación.`,
    };
  }
  if (!agentId) return { ok: 0, skipped: ids.length, error: "Selecciona un ejecutivo." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_mail_engagement_opportunities", {
    p_lead_ids: ids,
    p_agent_id: agentId,
    p_mail_campaign_id: null,
    p_campaign_id: null,
  });
  if (error) return { ok: 0, skipped: ids.length, error: error.message };
  const payload = data as { assigned?: number } | null;
  const ok = Number(payload?.assigned ?? 0);

  // La consola, la ficha y la cola general leen el mismo responsable actual.
  revalidatePath("/dashboard/mail");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/team");

  return { ok, skipped: 0, error: null };
}
