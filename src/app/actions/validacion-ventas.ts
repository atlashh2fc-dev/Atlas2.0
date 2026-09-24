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

function toRow(row: Record<string, unknown>): SaleValidationRow {
  return {
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
  };
}

export async function listSaleValidations(status: SaleValidationStatus): Promise<SaleValidationRow[]> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_sale_validations", { p_status: status, p_limit: 1000 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toRow);
}

export type SaleValidationFilters = {
  status: SaleValidationStatus;
  query?: string | null;
  /** Fechas YYYY-MM-DD en hora Chile: de la decisión, o de la venta si está pendiente. */
  from?: string | null;
  to?: string | null;
  agent?: string | null;
  product?: string | null;
};

/** Buscador del universo de ventas (search_sale_validations). */
export async function searchSaleValidations(filters: SaleValidationFilters): Promise<SaleValidationRow[]> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_sale_validations", {
    p_status: filters.status,
    p_query: filters.query || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_agent: filters.agent || null,
    p_product: filters.product || null,
    p_limit: 5000,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toRow);
}

/**
 * Aprueba o rechaza varias ventas de una vez. Todo o nada: si una no se puede
 * decidir, no se decide ninguna y el error dice por qué.
 */
export async function resolveSales(input: {
  ids: string[];
  decision: "aprobada" | "rechazada";
  note: string | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireProfile(["supervisor", "admin"]);
    const note = input.note?.trim() || null;
    if (input.ids.length === 0) throw new Error("Selecciona al menos una venta.");
    if (input.decision === "rechazada" && !note) throw new Error("Indica por qué se rechaza.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("resolve_sale_validations", {
      p_validation_ids: input.ids,
      p_decision: input.decision,
      p_note: note,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/validacion-ventas");
    revalidatePath("/dashboard/validacion-ventas/validadas");
    return { ok: true, count: Number(data ?? 0) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo guardar la decisión." };
  }
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
