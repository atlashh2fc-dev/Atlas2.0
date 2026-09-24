"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Números de un registro. Cualquiera que vea la ficha los lista (el ejecutivo
 * elige cuál marcar); solo supervisión y administración los agrega, da de baja
 * o cambia el principal. Las RPC validan rol, empresa y equipo: la pantalla
 * solo decide qué botones mostrar.
 */
export type LeadDialPhone = {
  contactId: string | null;
  dialDigits: string;
  phone: string;
  label: string | null;
  source: string | null;
  isPrimary: boolean;
  /** Motivo por el que está en la lista de no llamar, o null. */
  blockedReason: string | null;
};

export async function listLeadDialPhones(leadId: string): Promise<LeadDialPhone[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lead_dial_phones", { p_lead_id: leadId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    contactId: typeof row.contact_id === "string" ? row.contact_id : null,
    dialDigits: String(row.dial_digits),
    phone: String(row.phone ?? row.dial_digits),
    label: typeof row.label === "string" ? row.label : null,
    source: typeof row.source === "string" ? row.source : null,
    isPrimary: row.contact_id === null,
    blockedReason: typeof row.blocked_reason === "string" ? row.blocked_reason : null,
  }));
}

export async function addLeadPhone(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const leadId = String(formData.get("lead_id") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!leadId || !phone) throw new Error("Ingresa el número.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_lead_phone", {
    p_lead_id: leadId,
    p_phone: phone,
    p_label: label || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
}

export async function deactivateLeadPhone(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const leadId = String(formData.get("lead_id") ?? "");
  const contactId = String(formData.get("contact_id") ?? "");
  if (!contactId) throw new Error("No se identificó el número.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_lead_phone", { p_contact_id: contactId });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
}

export async function setLeadPrimaryPhone(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const leadId = String(formData.get("lead_id") ?? "");
  const phone = String(formData.get("phone") ?? "");
  if (!leadId || !phone) throw new Error("No se identificó el número.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_lead_primary_phone", { p_lead_id: leadId, p_phone: phone });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
}

/**
 * Libera un número de la lista de no llamar (p. ej. un CLIENTE MOLESTO del
 * historial). Solo supervisión y administración; queda registrado quién,
 * cuándo y por qué, y el lead vuelve a la cola si no hay otra razón.
 */
export async function liftLeadPhoneSuppression(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const leadId = String(formData.get("lead_id") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!leadId || !phone) throw new Error("No se identificó el número.");
  if (!reason) throw new Error("Indica por qué se libera el número.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("lift_lead_phone_suppression", {
    p_lead_id: leadId,
    p_phone: phone,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
}
