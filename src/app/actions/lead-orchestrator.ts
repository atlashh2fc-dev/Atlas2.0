"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const VALID_OPERATORS = ["eq", "neq", "contains", "gte", "lte", "is_empty", "is_not_empty"];

function campaignPath(campaignId: string) {
  return `/dashboard/admin/campanas/${campaignId}/priorizacion`;
}

export async function saveLeadOrchestratorConfig(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = String(formData.get("campaign_id") ?? "");
  if (!campaignId) throw new Error("Falta la campaña.");

  const tickSeconds = Number(formData.get("tick_seconds"));
  const assignmentTtlSeconds = Number(formData.get("assignment_ttl_seconds"));
  const maxDispatchPerTick = Number(formData.get("max_dispatch_per_tick"));
  const fallbackOrder = formData.get("fallback_order") === "newest_first" ? "newest_first" : "oldest_first";

  if (!Number.isInteger(tickSeconds) || tickSeconds < 2 || tickSeconds > 300) {
    throw new Error("El intervalo debe estar entre 2 y 300 segundos.");
  }
  if (!Number.isInteger(assignmentTtlSeconds) || assignmentTtlSeconds < 60 || assignmentTtlSeconds > 14400) {
    throw new Error("La reserva debe durar entre 60 segundos y 4 horas.");
  }
  if (!Number.isInteger(maxDispatchPerTick) || maxDispatchPerTick < 1 || maxDispatchPerTick > 100) {
    throw new Error("El máximo por ciclo debe estar entre 1 y 100.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("lead_orchestrator_configs").upsert({
    campaign_id: campaignId,
    is_active: formData.get("is_active") === "true",
    tick_seconds: tickSeconds,
    assignment_ttl_seconds: assignmentTtlSeconds,
    max_dispatch_per_tick: maxDispatchPerTick,
    fallback_order: fallbackOrder,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath(campaignPath(campaignId));
}

export async function createLeadPriorityRule(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = String(formData.get("campaign_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const fieldName = String(formData.get("field_name") ?? "").trim();
  const operator = String(formData.get("operator") ?? "");
  const comparisonValue = String(formData.get("comparison_value") ?? "").trim() || null;
  const position = Number(formData.get("position"));

  if (!campaignId || !name || !fieldName) throw new Error("Completa nombre y campo de la regla.");
  if (!Number.isInteger(position) || position < 1 || position > 1000) {
    throw new Error("La prioridad debe ser un entero entre 1 y 1000.");
  }
  if (!VALID_OPERATORS.includes(operator)) throw new Error("Operador inválido.");
  if (!operator.startsWith("is_") && comparisonValue === null) {
    throw new Error("La regla necesita un valor de comparación.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("lead_priority_rules").insert({
    campaign_id: campaignId,
    name,
    field_name: fieldName,
    operator,
    comparison_value: comparisonValue,
    position,
  });
  if (error?.code === "23505") throw new Error("Ya existe una regla en esa posición.");
  if (error) throw new Error(error.message);
  revalidatePath(campaignPath(campaignId));
}

export async function toggleLeadPriorityRule(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = String(formData.get("campaign_id") ?? "");
  const ruleId = String(formData.get("rule_id") ?? "");
  const active = formData.get("active") === "true";
  if (!campaignId || !ruleId) throw new Error("Falta la regla.");

  const supabase = await createClient();
  const { error } = await supabase.from("lead_priority_rules").update({ is_active: !active }).eq("id", ruleId);
  if (error) throw new Error(error.message);
  revalidatePath(campaignPath(campaignId));
}

export async function deleteLeadPriorityRule(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = String(formData.get("campaign_id") ?? "");
  const ruleId = String(formData.get("rule_id") ?? "");
  if (!campaignId || !ruleId) throw new Error("Falta la regla.");

  const supabase = await createClient();
  const { error } = await supabase.from("lead_priority_rules").delete().eq("id", ruleId);
  if (error) throw new Error(error.message);
  revalidatePath(campaignPath(campaignId));
}

export async function completeKovacsDemoAssignment(formData: FormData) {
  const profile = await requireProfile(["agente"]);
  const leadId = String(formData.get("lead_id") ?? "");
  if (!leadId) throw new Error("Falta el lead.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_my_kovacs_demo_assignment", { p_lead_id: leadId });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
  void profile;
}
