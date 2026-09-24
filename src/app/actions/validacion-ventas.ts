"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Validación de ventas por supervisión (reemplaza el backoffice de Atlas 1).
 * Cada llamada cerrada como VENTA EN VALIDACION deja una fila pendiente;
 * aprobarla lleva el registro a «convertido», rechazarla exige motivo y no lo
 * avanza. Las RPC validan rol, empresa y equipo: la pantalla solo decide qué
 * mostrar. Ver la migración 20260925030000_supervision_valida_ventas.sql.
 */
export type SaleValidationStatus = "pendiente" | "aprobada" | "rechazada" | "anulada";

export type SaleValidationRow = {
  id: string;
  status: SaleValidationStatus;
  soldAt: string;
  leadId: string;
  leadName: string | null;
  leadRut: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  leadStatus: string | null;
  campaignName: string | null;
  teamName: string | null;
  agentName: string | null;
  products: string[];
  ufAmount: number | null;
  recipientEmail: string | null;
  agentNotes: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  decisionSource: "supervision" | "atlas1" | "revision" | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function listSaleValidations(status: SaleValidationStatus): Promise<SaleValidationRow[]> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_sale_validations", { p_status: status, p_limit: 500 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    status: row.status as SaleValidationStatus,
    soldAt: String(row.sold_at),
    leadId: String(row.lead_id),
    leadName: text(row.lead_name),
    leadRut: text(row.lead_rut),
    leadPhone: text(row.lead_phone),
    leadEmail: text(row.lead_email),
    leadStatus: text(row.lead_status),
    campaignName: text(row.campaign_name),
    teamName: text(row.team_name),
    agentName: text(row.agent_name),
    products: Array.isArray(row.products) ? (row.products as string[]) : [],
    ufAmount: row.uf_amount == null ? null : Number(row.uf_amount),
    recipientEmail: text(row.recipient_email),
    agentNotes: text(row.agent_notes),
    decidedAt: text(row.decided_at),
    decidedByName: text(row.decided_by_name),
    decisionNote: text(row.decision_note),
    decisionSource: (text(row.decision_source) as SaleValidationRow["decisionSource"]) ?? null,
  }));
}

export async function countSaleValidations(): Promise<Record<SaleValidationStatus, number>> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("count_sale_validations");
  if (error) throw new Error(error.message);
  const counts: Record<SaleValidationStatus, number> = { pendiente: 0, aprobada: 0, rechazada: 0, anulada: 0 };
  for (const row of (data ?? []) as { status: SaleValidationStatus; total: number }[]) {
    counts[row.status] = Number(row.total);
  }
  return counts;
}

async function resolve(formData: FormData, decision: "aprobada" | "rechazada") {
  await requireProfile(["supervisor", "admin"]);
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) throw new Error("No se identificó la venta.");
  if (decision === "rechazada" && !note) throw new Error("Indica por qué se rechaza la venta.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_sale_validation", {
    p_validation_id: id,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/validacion-ventas");
  const leadId = (data as { lead_id?: string } | null)?.lead_id;
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
}

export async function approveSale(formData: FormData) {
  await resolve(formData, "aprobada");
}

export async function rejectSale(formData: FormData) {
  await resolve(formData, "rechazada");
}
