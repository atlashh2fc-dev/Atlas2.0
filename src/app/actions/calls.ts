"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CALL_REASONS,
  buildCallReasonCatalogFromWorkflow,
  validateCallClosure,
  type CallStatus,
  type CallOutcome,
} from "@/lib/call-typification";
import type { Call, WorkflowStep, WorkflowStepBranch } from "@/lib/types";

async function requireAgent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  return { supabase, userId: user.id };
}

function inferNextActionWindow(nextActionAt: string | null): string | null {
  if (!nextActionAt) return null;
  const date = new Date(nextActionAt);
  if (Number.isNaN(date.getTime())) return null;
  const hourText = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const start = String(hour).padStart(2, "0");
  const end = String((hour + 1) % 24).padStart(2, "0");
  return `${start}:00-${end}:00`;
}

/**
 * Devuelve la llamada abierta (sin cerrar) del agente actual para este lead,
 * o crea una nueva si no existe ninguna. Se usa al entrar a la ficha de
 * gestión, así el agente nunca pierde el progreso de una llamada en curso.
 */
export async function getOrCreateOpenCall(leadId: string): Promise<Call> {
  const { supabase, userId } = await requireAgent();

  const { data: existing, error: findError } = await supabase
    .from("calls")
    .select("*")
    .eq("lead_id", leadId)
    .eq("agent_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existing) return existing as Call;

  const { data: created, error: insertError } = await supabase
    .from("calls")
    .insert({ lead_id: leadId, agent_id: userId })
    .select("*")
    .single();

  if (insertError) throw new Error(insertError.message);
  return created as Call;
}

/**
 * Busca llamadas cerradas con la misma fecha/hora de agenda para el mismo
 * lead/contacto (mismo rut o teléfono) dentro de la misma campaña
 * (leads.campaign_id). Si el lead no pertenece a ninguna campaña, se acota
 * por team_id como respaldo (comportamiento histórico previo a campañas).
 */
async function findAgendaConflict(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  leadId: string;
  excludeCallId: string;
  nextActionAt: string;
}) {
  const { supabase, leadId, excludeCallId, nextActionAt } = params;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, rut, phone, team_id, campaign_id")
    .eq("id", leadId)
    .single();
  if (leadError) throw new Error(leadError.message);

  let relatedLeadIds = [leadId];
  if (lead.rut || lead.phone) {
    let relatedQuery = supabase.from("leads").select("id");
    relatedQuery = lead.campaign_id
      ? relatedQuery.eq("campaign_id", lead.campaign_id)
      : relatedQuery.eq("team_id", lead.team_id);
    const orFilters = [
      lead.rut ? `rut.eq.${lead.rut}` : null,
      lead.phone ? `phone.eq.${lead.phone}` : null,
    ].filter(Boolean);
    if (orFilters.length > 0) {
      relatedQuery = relatedQuery.or(orFilters.join(","));
    }
    const { data: relatedLeads, error: relatedError } = await relatedQuery;
    if (relatedError) throw new Error(relatedError.message);
    relatedLeadIds = (relatedLeads ?? []).map((l) => l.id);
    if (!relatedLeadIds.includes(leadId)) relatedLeadIds.push(leadId);
  }

  const { data: conflicts, error: conflictError } = await supabase
    .from("calls")
    .select("id")
    .in("lead_id", relatedLeadIds)
    .not("ended_at", "is", null)
    .eq("next_action_at", nextActionAt)
    .neq("id", excludeCallId)
    .limit(1);

  if (conflictError) throw new Error(conflictError.message);
  return (conflicts ?? []).length > 0;
}

async function getLeadCallReasonCatalog(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  lead: { workflow_id?: string | null; campaign_id?: string | null };
}) {
  const { supabase, lead } = params;
  let workflowId = lead.workflow_id ?? null;

  if (!workflowId && lead.campaign_id) {
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("workflow_id")
      .eq("id", lead.campaign_id)
      .maybeSingle();
    if (campaignError) throw new Error(campaignError.message);
    workflowId = campaign?.workflow_id ?? null;
  }

  if (!workflowId) return CALL_REASONS;

  const [{ data: steps, error: stepsError }, { data: branches, error: branchesError }] = await Promise.all([
    supabase.from("workflow_steps").select("*").eq("workflow_id", workflowId).order("step_order", { ascending: true }),
    supabase.from("workflow_step_branches").select("*").eq("workflow_id", workflowId),
  ]);

  if (stepsError) throw new Error(stepsError.message);
  if (branchesError) throw new Error(branchesError.message);

  const catalog = buildCallReasonCatalogFromWorkflow(
    (steps ?? []) as WorkflowStep[],
    (branches ?? []) as WorkflowStepBranch[]
  );

  return catalog.length > 0 ? catalog : CALL_REASONS;
}

/** Guardar avance sin cerrar la llamada. */
export async function saveCallProgress(input: {
  callId: string;
  leadId: string;
  status: CallStatus | null;
  outcome: CallOutcome | null;
  reason: string | null;
  notes: string | null;
}) {
  const { supabase, userId } = await requireAgent();
  const { callId, leadId, status, outcome, reason, notes } = input;

  const { error: updateError } = await supabase
    .from("calls")
    .update({
      status,
      outcome,
      reason,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId);
  if (updateError) throw new Error(updateError.message);

  await supabase.from("call_events").insert({
    call_id: callId,
    lead_id: leadId,
    agent_id: userId,
    event_type: "call.progress_updated",
    payload: { status, outcome, reason },
  });

  // Sincronización no destructiva: solo se actualizan los campos que el
  // agente efectivamente está dejando en esta gestión.
  const leadUpdate: Record<string, unknown> = {};
  if (reason) leadUpdate.tipificacion_actual = reason;
  if (notes !== null && notes !== undefined && notes !== "") leadUpdate.observacion_actual = notes;
  if (Object.keys(leadUpdate).length > 0) {
    const { error: leadError } = await supabase.from("leads").update(leadUpdate).eq("id", leadId);
    if (leadError) throw new Error(leadError.message);
  }

  revalidatePath(`/dashboard/leads/${leadId}`);
}

/** Guardar agenda (fecha/hora de próximo contacto) sin cerrar la llamada. */
export async function saveCallAgenda(input: {
  callId: string;
  leadId: string;
  nextActionAt: string;
}) {
  const { supabase, userId } = await requireAgent();
  const { callId, leadId, nextActionAt } = input;

  if (!nextActionAt || Number.isNaN(new Date(nextActionAt).getTime())) {
    throw new Error("Selecciona una fecha y hora de agenda válida.");
  }

  const hasConflict = await findAgendaConflict({ supabase, leadId, excludeCallId: callId, nextActionAt });
  if (hasConflict) {
    throw new Error(
      "Ya existe una agenda cerrada para este lead/contacto, en la misma campaña, para esa fecha y hora exacta."
    );
  }

  const { error } = await supabase
    .from("calls")
    .update({
      next_action_at: nextActionAt,
      next_action_window: inferNextActionWindow(nextActionAt),
      callback_owner_user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId);
  if (error) throw new Error(error.message);

  await supabase.from("call_events").insert({
    call_id: callId,
    lead_id: leadId,
    agent_id: userId,
    event_type: "call.agenda_saved",
    payload: { next_action_at: nextActionAt, next_action_window: inferNextActionWindow(nextActionAt) },
  });

  revalidatePath(`/dashboard/leads/${leadId}`);
}

/** Cerrar la gestión ("Guardar y terminar"): valida todo y persiste el cierre. */
export async function closeCall(input: {
  callId: string;
  leadId: string;
  status: CallStatus | null;
  outcome: CallOutcome | null;
  reason: string | null;
  notes: string | null;
  next_action_at: string | null;
  equifax_products: string[];
  equifax_uf_amount: number | null;
  equifax_recipient_email: string | null;
}) {
  const { supabase } = await requireAgent();
  const {
    callId,
    leadId,
    status,
    outcome,
    reason,
    notes,
    next_action_at,
    equifax_products,
    equifax_uf_amount,
    equifax_recipient_email,
  } = input;

  const { data: lead, error: leadFetchError } = await supabase
    .from("leads")
    .select("id, email, workflow_id, campaign_id")
    .eq("id", leadId)
    .single();
  if (leadFetchError) throw new Error(leadFetchError.message);
  const reasonCatalog = await getLeadCallReasonCatalog({ supabase, lead });

  const errors = validateCallClosure(
    {
      status,
      outcome,
      reason,
      notes,
      next_action_at,
      equifax_products,
      equifax_uf_amount,
      equifax_recipient_email,
      lead_email: lead.email,
      contact_email: lead.email,
    },
    reasonCatalog
  );
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  const { error: closeError } = await supabase.rpc("save_call_management", {
    p_call_id: callId,
    p_lead_id: leadId,
    p_status: status,
    p_outcome: outcome,
    p_reason: reason,
    p_notes: notes,
    p_next_action_at: next_action_at,
    p_next_action_window: inferNextActionWindow(next_action_at),
    p_equifax_products: equifax_products,
    p_equifax_uf_amount: equifax_uf_amount,
    p_equifax_recipient_email: equifax_recipient_email,
  });
  if (closeError) throw new Error(closeError.message);

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
  redirect("/dashboard/leads");
}

/**
 * Descartar la llamada por error técnico: cierra el registro de la llamada
 * pero NO escribe tipificación ni estado de gestión en el lead, porque no
 * hubo gestión real del agente.
 */
export async function discardCallTechnicalError(input: { callId: string; leadId: string; reason: string }) {
  const { supabase, userId } = await requireAgent();
  const { callId, leadId, reason } = input;

  const { error } = await supabase
    .from("calls")
    .update({
      ended_at: new Date().toISOString(),
      discarded_reason: reason,
      status: null,
      outcome: null,
      reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId);
  if (error) throw new Error(error.message);

  await supabase.from("call_events").insert({
    call_id: callId,
    lead_id: leadId,
    agent_id: userId,
    event_type: "call.discarded",
    payload: { reason },
  });

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
  redirect("/dashboard/leads");
}
