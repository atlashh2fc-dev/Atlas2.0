"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type BulkResult = { ok: number; skipped: number; error: string | null };

const BULK_MAX = 250;

/**
 * Asignación masiva. Reutiliza la RPC `assign_lead` registro por registro para
 * conservar la traza (motivo y origen) que ya usa la asignación individual, en
 * vez de un `update` directo que dejaría el cambio sin historia.
 */
export async function bulkAssignLeads(leadIds: string[], agentId: string | null): Promise<BulkResult> {
  await requireProfile(["supervisor", "admin"]);
  const ids = [...new Set(leadIds)].slice(0, BULK_MAX);
  if (ids.length === 0) return { ok: 0, skipped: 0, error: "No hay registros seleccionados." };

  const supabase = await createClient();
  let ok = 0;

  for (const leadId of ids) {
    const { error } = await supabase.rpc("assign_lead", {
      p_lead_id: leadId,
      p_agent_id: agentId,
      p_reason: agentId ? "Asignación masiva desde Registros" : "Desasignación masiva desde Registros",
      p_source: "leads.bulk_assign",
      p_set_managed_by: false,
      p_next_action_at: null,
    });
    if (error) return { ok, skipped: ids.length - ok, error: error.message };
    ok += 1;
  }

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/team");
  return { ok, skipped: leadIds.length - ok, error: null };
}

/**
 * Reparto automático por carga: distribuye los registros seleccionados entre
 * los ejecutivos elegidos, dándole siempre el siguiente al que tenga menos
 * registros asignados. Reemplaza el clic-por-clic de la asignación individual,
 * que era el cuello de botella real del supervisor.
 */
export async function distributeLeads(leadIds: string[], agentIds: string[]): Promise<BulkResult> {
  await requireProfile(["supervisor", "admin"]);
  const ids = [...new Set(leadIds)].slice(0, BULK_MAX);
  const agents = [...new Set(agentIds)];
  if (ids.length === 0) return { ok: 0, skipped: 0, error: "No hay registros seleccionados." };
  if (agents.length === 0) return { ok: 0, skipped: ids.length, error: "Elige al menos un ejecutivo." };

  const supabase = await createClient();

  // Carga actual de cada ejecutivo, para partir desde el más descargado.
  const { data: current, error: loadError } = await supabase
    .from("leads")
    .select("assigned_to")
    .in("assigned_to", agents)
    .limit(20000);
  if (loadError) return { ok: 0, skipped: ids.length, error: loadError.message };

  const load = new Map<string, number>(agents.map((id) => [id, 0]));
  for (const row of current ?? []) {
    if (row.assigned_to) load.set(row.assigned_to, (load.get(row.assigned_to) ?? 0) + 1);
  }

  let ok = 0;
  for (const leadId of ids) {
    const target = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    const { error } = await supabase.rpc("assign_lead", {
      p_lead_id: leadId,
      p_agent_id: target,
      p_reason: "Reparto automático por carga desde Mi equipo",
      p_source: "team.distribute",
      p_set_managed_by: false,
      p_next_action_at: null,
    });
    if (error) return { ok, skipped: ids.length - ok, error: error.message };
    load.set(target, (load.get(target) ?? 0) + 1);
    ok += 1;
  }

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/leads");
  return { ok, skipped: leadIds.length - ok, error: null };
}

/**
 * Reagenda en lote conservando al responsable actual. Los registros sin
 * responsable se omiten: reagendar sin dueño dejaría una agenda sin ejecutivo.
 */
export async function bulkRescheduleLeads(leadIds: string[], nextActionAt: string): Promise<BulkResult> {
  await requireProfile(["supervisor", "admin"]);
  const ids = [...new Set(leadIds)].slice(0, BULK_MAX);
  if (ids.length === 0) return { ok: 0, skipped: 0, error: "No hay registros seleccionados." };

  const when = new Date(nextActionAt);
  if (Number.isNaN(when.getTime())) return { ok: 0, skipped: ids.length, error: "La fecha no es válida." };

  const supabase = await createClient();
  const { data: leads, error: readError } = await supabase
    .from("leads")
    .select("id, assigned_to, managed_by")
    .in("id", ids);
  if (readError) return { ok: 0, skipped: ids.length, error: readError.message };

  let ok = 0;
  let skipped = 0;

  for (const lead of leads ?? []) {
    const owner = lead.managed_by ?? lead.assigned_to;
    if (!owner) {
      skipped += 1;
      continue;
    }
    const { error } = await supabase.rpc("assign_lead", {
      p_lead_id: lead.id,
      p_agent_id: owner,
      p_reason: "Reagendamiento masivo desde Registros",
      p_source: "leads.bulk_reschedule",
      p_set_managed_by: false,
      p_next_action_at: when.toISOString(),
    });
    if (error) return { ok, skipped, error: error.message };
    ok += 1;
  }

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard/team");
  return { ok, skipped, error: null };
}

export async function registerInteraction(formData: FormData) {
  const leadId = formData.get("lead_id") as string;
  const resultValues = formData.getAll("result").map(String).filter(Boolean);
  const result = resultValues.join(", ");
  const notes = (formData.get("notes") as string) || null;
  const newStatus = formData.get("new_status") as string | null;
  const workflowStepId = (formData.get("workflow_step_id") as string) || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const { error: insertError } = await supabase.from("interactions").insert({
    lead_id: leadId,
    agent_id: user.id,
    result,
    notes,
    workflow_step_id: workflowStepId,
  });

  if (insertError) throw new Error(insertError.message);

  if (newStatus) {
    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
  }

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}
