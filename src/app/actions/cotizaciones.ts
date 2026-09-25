"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Cotizaciones enviadas del ejecutivo (Secretaria Virtual y toda campaña cuyo
 * flujo tenga «Cotización Enviada» sin el contrato Equifax). El estado sale del
 * historial: la última gestión de venta o de no interés posterior a la
 * cotización. Marcarla vendida deja una VENTA EN VALIDACION que va a la cola de
 * supervisión; no vendida, un motivo del paso «No Interesa» del flujo. Ver la
 * migración 20260925233000_ejecutivo_resuelve_sus_cotizaciones.sql.
 */
export type QuotationState = "pendiente" | "vendida" | "no_vendida";
export type QuotationChannel = "whatsapp" | "correo" | "presencial" | "otro";

export type QuotationRow = {
  leadId: string;
  leadName: string | null;
  leadRut: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  campaignId: string | null;
  quotedAt: string;
  quoteNotes: string | null;
  /** Agenda de seguimiento vigente del registro. */
  followUpAt: string | null;
  state: QuotationState;
  decidedAt: string | null;
  decisionReason: string | null;
  decisionNotes: string | null;
  decisionChannel: string | null;
  /** Estado de la venta en la cola de supervisión, cuando se marcó vendida. */
  validationStatus: "pendiente" | "aprobada" | "rechazada" | "anulada" | null;
  validationNote: string | null;
};

export type QuotationCampaign = { id: string; name: string; lostReasons: string[] };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toRow(row: Record<string, unknown>): QuotationRow {
  return {
    leadId: String(row.lead_id),
    leadName: text(row.lead_name),
    leadRut: text(row.lead_rut),
    leadPhone: text(row.lead_phone),
    leadEmail: text(row.lead_email),
    campaignId: text(row.campaign_id),
    quotedAt: String(row.quoted_at),
    quoteNotes: text(row.quote_notes),
    followUpAt: text(row.follow_up_at),
    state: row.state as QuotationState,
    decidedAt: text(row.decided_at),
    decisionReason: text(row.decision_reason),
    decisionNotes: text(row.decision_notes),
    decisionChannel: text(row.decision_channel),
    validationStatus: (text(row.validation_status) as QuotationRow["validationStatus"]) ?? null,
    validationNote: text(row.validation_note),
  };
}

export async function getAgentQuotations(): Promise<{ campaigns: QuotationCampaign[]; rows: QuotationRow[] }> {
  await requireProfile(["agente"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_agent_quotations");
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as { campaigns?: Record<string, unknown>[]; rows?: Record<string, unknown>[] };
  return {
    campaigns: (value.campaigns ?? []).map((campaign) => ({
      id: String(campaign.id),
      name: String(campaign.name ?? "Campaña"),
      lostReasons: Array.isArray(campaign.lost_reasons) ? (campaign.lost_reasons as string[]) : [],
    })),
    rows: (value.rows ?? []).map(toRow),
  };
}

export async function resolveQuotation(input: {
  leadId: string;
  result: "vendida" | "no_vendida";
  channel: QuotationChannel;
  reason: string | null;
  notes: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireProfile(["agente"]);
    if (input.result === "no_vendida" && !input.reason) throw new Error("Elige el motivo por el que no se vendió.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("resolve_agent_quotation", {
      p_lead_id: input.leadId,
      p_result: input.result,
      p_channel: input.channel,
      p_reason: input.result === "no_vendida" ? input.reason : null,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/leads/cotizaciones");
    revalidatePath(`/dashboard/leads/${input.leadId}`);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/agenda");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo guardar el estado de la cotización." };
  }
}
