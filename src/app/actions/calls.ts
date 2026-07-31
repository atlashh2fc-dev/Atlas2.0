"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  CALL_REASONS,
  buildCallReasonCatalogFromWorkflow,
  validateCallClosure,
  type CallStatus,
  type CallOutcome,
} from "@/lib/call-typification";
import { LEGAL_INTERCALL_BREAK_MS } from "@/lib/intercall-break";
import type { Call, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { requireProfile } from "@/lib/auth";

async function requireAgent() {
  const profile = await requireProfile(["agente"]);
  const supabase = await createClient();
  return { supabase, userId: profile.id };
}

/** La interrupción termina cuando la gestión queda cerrada. */
async function clearLegalIntercallBreak(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ intercall_break_until: null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

async function releaseAgentFromWrapUp(userId: string, campaignId: string | null) {
  if (!campaignId) return;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("dialer_agent_sessions")
    .update({
      status: "available",
      last_state_change_at: now,
      updated_at: now,
    })
    .eq("profile_id", userId)
    .eq("campaign_id", campaignId)
    .eq("status", "wrap_up");
  if (error) throw new Error(error.message);
}

async function getLeadCampaignId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("campaign_id")
    .eq("id", leadId)
    .single();
  if (error) throw new Error(error.message);
  return data.campaign_id;
}

/**
 * Marca el inicio de la interrupción legal en el servidor. Antes vivía solo en
 * `localStorage`, así que se saltaba borrando una clave del navegador.
 */
export async function startLegalIntercallBreak(): Promise<void> {
  const { userId } = await requireAgent();
  const admin = createAdminClient();
  const until = new Date(Date.now() + LEGAL_INTERCALL_BREAK_MS).toISOString();
  const { error } = await admin
    .from("profiles")
    .update({ intercall_break_until: until })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Deja constancia de una llamada marcada a mano desde el CTI. Antes no quedaba
 * ningún rastro: no había forma de auditar a quién se llamó ni de exigir la
 * tipificación de esa gestión.
 */
export async function registerManualCall(input: {
  phone: string;
  leadId?: string | null;
  contactName?: string | null;
}): Promise<void> {
  const { userId } = await requireAgent();
  const admin = createAdminClient();

  const { error } = await admin.from("sensitive_access_log").insert({
    actor_id: userId,
    action: "cti.manual_call",
    target_profile_id: null,
    metadata: {
      phone: input.phone,
      lead_id: input.leadId ?? null,
      contact_name: input.contactName ?? null,
    },
  });
  if (error) throw new Error(error.message);

  // Si la llamada es sobre un registro conocido, además queda en su historial.
  if (input.leadId) {
    const { error: eventError } = await admin.from("call_events").insert({
      lead_id: input.leadId,
      agent_id: userId,
      event_type: "cti.manual_call",
      payload: { phone: input.phone, source: "cti" },
    });
    if (eventError) throw new Error(eventError.message);
  }
}

export type ManualCallManagement = {
  leadId: string;
  callId: string;
  campaignId: string;
  leadCreated: boolean;
  leadReused: boolean;
};

/**
 * Abre la gestión que respalda una llamada manual de un ejecutivo. A
 * diferencia de `registerManualCall`, esta operación crea/reutiliza el lead y
 * la llamada abierta en una sola transacción, para que siempre exista una
 * ficha donde tipificar y cerrar el ACW correctamente.
 */
export async function beginManualCallManagement(input: {
  campaignId: string;
  phone: string;
  contactName?: string | null;
  entryMode: "before_dial" | "after_call";
}): Promise<ManualCallManagement> {
  const { supabase } = await requireAgent();
  const { data, error } = await supabase.rpc("begin_agent_manual_call_management", {
    p_campaign_id: input.campaignId,
    p_phone: input.phone,
    p_full_name: input.contactName?.trim() || null,
    p_entry_mode: input.entryMode,
  });
  if (error) throw new Error(error.message);

  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const leadId = value?.lead_id;
  const callId = value?.call_id;
  const campaignId = value?.campaign_id;
  if (typeof leadId !== "string" || typeof callId !== "string" || typeof campaignId !== "string") {
    throw new Error("La llamada manual no devolvió una gestión válida.");
  }

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");

  return {
    leadId,
    callId,
    campaignId,
    leadCreated: value?.lead_created === true,
    leadReused: value?.lead_reused === true,
  };
}

async function assertIntercallBreakCompleted(params: {
  userId: string;
  campaignId: string | null;
  requireCallEnded?: boolean;
}) {
  const { userId, campaignId, requireCallEnded = false } = params;
  const admin = createAdminClient();

  // Vale para toda llamada, tenga campaña o no: es una obligación del
  // ejecutivo, no de la campaña.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("intercall_break_until")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const breakUntil = profile?.intercall_break_until
    ? new Date(profile.intercall_break_until).getTime()
    : 0;
  if (breakUntil > Date.now()) {
    const remaining = Math.max(1, Math.ceil((breakUntil - Date.now()) / 1000));
    throw new Error(
      `Interrupción legal en curso. Espera ${remaining} segundo${remaining === 1 ? "" : "s"} antes de continuar.`
    );
  }

  if (!campaignId) return;

  const { data: session, error } = await admin
    .from("dialer_agent_sessions")
    .select("status, last_state_change_at")
    .eq("profile_id", userId)
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!session) return;

  if (
    requireCallEnded &&
    (session.status === "ringing" || session.status === "on_call")
  ) {
    throw new Error("Finaliza la llamada antes de cerrar la gestión.");
  }

  if (session.status !== "wrap_up") return;
  const elapsedMs = Date.now() - new Date(session.last_state_change_at).getTime();
  if (elapsedMs >= LEGAL_INTERCALL_BREAK_MS) return;

  const remaining = Math.max(
    1,
    Math.ceil((LEGAL_INTERCALL_BREAK_MS - elapsedMs) / 1000)
  );
  throw new Error(
    `Interrupción legal en curso. Espera ${remaining} segundo${remaining === 1 ? "" : "s"} antes de continuar la tipificación.`
  );
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
  const campaignId = await getLeadCampaignId(supabase, leadId);
  await assertIntercallBreakCompleted({ userId, campaignId });

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
  const campaignId = await getLeadCampaignId(supabase, leadId);
  await assertIntercallBreakCompleted({ userId, campaignId });

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
  const { supabase, userId } = await requireAgent();
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
  await assertIntercallBreakCompleted({
    userId,
    campaignId: lead.campaign_id,
    requireCallEnded: true,
  });
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
  await clearLegalIntercallBreak(userId);
  await releaseAgentFromWrapUp(userId, lead.campaign_id);

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}

/**
 * Descartar la llamada por error técnico: cierra el registro de la llamada
 * pero NO escribe tipificación ni estado de gestión en el lead, porque no
 * hubo gestión real del agente.
 */
export async function discardCallTechnicalError(input: { callId: string; leadId: string; reason: string }) {
  const { supabase, userId } = await requireAgent();
  const { callId, leadId, reason } = input;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("campaign_id")
    .eq("id", leadId)
    .single();
  if (leadError) throw new Error(leadError.message);
  await assertIntercallBreakCompleted({
    userId,
    campaignId: lead.campaign_id,
    requireCallEnded: true,
  });

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

  await clearLegalIntercallBreak(userId);
  await releaseAgentFromWrapUp(userId, lead.campaign_id);

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}
