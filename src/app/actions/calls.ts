"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  CALL_REASONS,
  type CallAgendaPayload,
  agendaSlotError,
  buildCallReasonCatalogFromWorkflow,
  validateCallClosure,
  type CallStatus,
  type CallOutcome,
} from "@/lib/call-typification";
import { LEGAL_INTERCALL_BREAK_MS } from "@/lib/intercall-break";
import { dialerSuppressionMessage } from "@/lib/dialer-suppression";
import type { Call, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { requireProfile } from "@/lib/auth";
import { fetchCampaignAgendaPolicy } from "@/lib/campaign-agenda-policy";

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

/**
 * Estado al que vuelve la sesión del discador al terminar el cierre. Si el
 * ejecutivo eligió un AUX durante la tipificación queda 'paused': Asterisk ya
 * lo tenía pausado por el cierre y no emite evento que corrija la sesión, así
 * que 'available' lo dejaba contado como libre por el predictivo y elegible
 * para agendas personales, que marcan directo a su anexo.
 */
async function sessionStatusAfterWrapUp(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<"available" | "paused"> {
  const { data, error } = await admin
    .from("agent_current_status")
    .select("agent_status_reasons(is_pause)")
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reason = (data as any)?.agent_status_reasons as { is_pause: boolean } | null | undefined;
  return reason?.is_pause ? "paused" : "available";
}

async function releaseAgentFromWrapUp(userId: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const status = await sessionStatusAfterWrapUp(admin, userId);

  // Un ejecutivo puede pertenecer a varias campañas, pero solo puede mantener
  // una llamada a la vez. Al cerrar esa gestión hay que liberar cualquier ACW
  // residual suyo: limitar el UPDATE a la campaña del lead dejó sesiones
  // antiguas en wrap_up cuando el motor y la ficha no coincidían en campaña.
  const { error } = await admin
    .from("dialer_agent_sessions")
    .update({
      status,
      last_state_change_at: now,
      updated_at: now,
    })
    .eq("profile_id", userId)
    .eq("status", "wrap_up");
  if (error) throw new Error(error.message);
}

async function restoreAgentFromHybridManualMode(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { error } = await supabase.rpc("exit_agent_hybrid_manual_mode");
  if (error) throw new Error(error.message);
}

/**
 * Una llamada manual tampoco sale hacia la lista de no llamar: el discador ya
 * la respeta y un clic en la ficha no debería saltársela. La base responde
 * solo el motivo y solo dentro de la empresa del usuario.
 */
async function assertNotOnDoNotCallList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  target: { leadId: string } | { campaignId: string; phone: string }
) {
  const { data, error } =
    "leadId" in target
      ? await supabase.rpc("dialer_lead_block_reason", { p_lead_id: target.leadId })
      : await supabase.rpc("dialer_phone_block_reason", {
          p_campaign_id: target.campaignId,
          p_phone: target.phone,
        });
  if (error) {
    // La web puede quedar publicada antes que la migración 20260924181100: sin
    // la función todavía no hay lista que consultar, y no se bloquea el marcado.
    if (error.code === "PGRST202" || error.code === "42883") return;
    throw new Error(error.message);
  }
  const message = dialerSuppressionMessage(typeof data === "string" ? data : null);
  if (message) throw new Error(message);
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

export type PendingCallManagement = {
  leadId: string;
  callId: string | null;
};

export type AgendaCallbackManagement = {
  leadId: string;
  callId: string;
  campaignId: string;
  /** Móvil en E.164, ya normalizado desde el formato con que llegó la base. */
  phone: string;
  /** Los 8 dígitos del abonado, que es lo que marca el CTI. */
  subscriber: string;
  /** Número completo a marcar (56...): móvil o fijo, el que eligió el ejecutivo. */
  dialDigits: string | null;
  fullName: string | null;
};

/** Intentos que el motor todavía puede convertir en una gestión abierta. */
const LIVE_DIAL_ATTEMPT_STATUSES = [
  "queued",
  "originating",
  "ringing",
  "answered",
  "bridged",
] as const;

/**
 * Destino único del botón "Completar tipificación" del CTI. Recupera la
 * gestión abierta del ejecutivo; si no existe ninguna y tampoco hay un intento
 * vivo que vaya a crearla, la sesión quedó colgada en ACW y se libera.
 *
 * El formulario de tipificación solo se renderiza sobre una `call` con
 * `ended_at` nulo (ver `getOpenCall`). Antes, sin esa llamada, este botón
 * mandaba al ejecutivo a la ficha del último intento —una pantalla sin
 * formulario— y lo dejaba encerrado en "falta tipificar" sin poder recibir
 * llamadas ni cambiar de estado.
 */
export async function getMyPendingCallManagement(): Promise<PendingCallManagement | null> {
  const { supabase, userId } = await requireAgent();
  const { data: openCalls, error: callsError } = await supabase
    .from("calls")
    .select("id, lead_id")
    .eq("agent_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (callsError) throw new Error(callsError.message);
  if (openCalls?.[0]) {
    return { leadId: openCalls[0].lead_id, callId: openCalls[0].id };
  }

  const admin = createAdminClient();
  const { data: sessions, error: sessionsError } = await admin
    .from("dialer_agent_sessions")
    .select("id, campaign_id")
    .eq("profile_id", userId)
    .eq("status", "wrap_up")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (sessionsError) throw new Error(sessionsError.message);
  const session = sessions?.[0];
  if (!session) return null;

  // Un intento en curso significa que el screen-pop todavía puede crear la
  // gestión: ahí sí conviene abrir la ficha y esperar, no liberar el ACW.
  const { data: liveAttempts, error: liveError } = await admin
    .from("dial_attempts")
    .select("lead_id")
    .eq("agent_id", userId)
    .eq("campaign_id", session.campaign_id)
    .in("status", LIVE_DIAL_ATTEMPT_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (liveError) throw new Error(liveError.message);
  if (liveAttempts?.[0]) {
    return { leadId: liveAttempts[0].lead_id, callId: null };
  }

  const { error: releaseError } = await admin
    .from("dialer_agent_sessions")
    .update({
      status: await sessionStatusAfterWrapUp(admin, userId),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("status", "wrap_up");
  if (releaseError) {
    console.error("[calls.getMyPendingCallManagement] release failed", {
      sessionId: session.id,
      error: releaseError.message,
    });
    throw new Error(releaseError.message);
  }
  return null;
}

/**
 * Abre la gestión para llamar un compromiso de la agenda propia.
 *
 * El discado automático entrega estos callbacks solo dentro de su ventana y
 * solo si el ejecutivo estaba disponible; pasado ese rato el compromiso queda
 * vencido en "Mi agenda" y el marcado manual está bloqueado por ser campaña
 * automática. Esta acción es la vía de rescate: deja una `call` abierta sobre
 * el lead —que además reserva al ejecutivo frente al motor— para que el CTI
 * origine y la gestión termine tipificada como cualquier otra.
 */
export async function beginAgendaCallback(
  leadId: string,
  chosenPhone?: string | null
): Promise<CallActionResult<AgendaCallbackManagement>> {
  try {
    const { supabase } = await requireAgent();
    // Con un número elegido, la base valida ese número (que sea de la ficha y
    // no esté en la lista de no llamar); sin él, el principal, como antes.
    if (!chosenPhone) await assertNotOnDoNotCallList(supabase, { leadId });
    const { data, error } = await supabase.rpc("begin_agent_agenda_callback", {
      p_lead_id: leadId,
      p_phone: chosenPhone || null,
    });
    if (error) throw new Error(error.message);

    const value = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const callId = value?.call_id;
    const campaignId = value?.campaign_id;
    const phone = value?.phone;
    const subscriber = value?.subscriber;
    if (
      typeof callId !== "string" ||
      typeof campaignId !== "string" ||
      typeof phone !== "string" ||
      typeof subscriber !== "string"
    ) {
      throw new Error("La llamada de agenda no devolvió una gestión válida.");
    }

    revalidatePath(`/dashboard/leads/${leadId}`);
    revalidatePath("/dashboard/agenda");

    return {
      ok: true,
      data: {
        leadId,
        callId,
        campaignId,
        phone,
        subscriber,
        dialDigits: typeof value?.dial_digits === "string" ? value.dial_digits : null,
        fullName: typeof value?.full_name === "string" ? value.full_name : null,
      },
    };
  } catch (error) {
    return callActionError("beginAgendaCallback", error, { leadId });
  }
}

/** Opens one auditable call management for the currently assigned lead. */
export async function beginAssignedLeadCall(
  leadId: string,
  chosenPhone?: string | null
): Promise<CallActionResult<AgendaCallbackManagement>> {
  try {
    const { supabase } = await requireAgent();
    // Con un número elegido, la base valida ese número (que sea de la ficha y
    // no esté en la lista de no llamar); sin él, el principal, como antes.
    if (!chosenPhone) await assertNotOnDoNotCallList(supabase, { leadId });
    const { data, error } = await supabase.rpc("begin_agent_assigned_lead_call", {
      p_lead_id: leadId,
      p_phone: chosenPhone || null,
    });
    if (error) throw new Error(error.message);

    const value = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const callId = value?.call_id;
    const campaignId = value?.campaign_id;
    const phone = value?.phone;
    const subscriber = value?.subscriber;
    if (
      typeof callId !== "string" ||
      typeof campaignId !== "string" ||
      typeof phone !== "string" ||
      typeof subscriber !== "string"
    ) {
      throw new Error("La llamada asignada no devolvió una gestión válida.");
    }

    revalidatePath(`/dashboard/leads/${leadId}`);
    return {
      ok: true,
      data: {
        leadId,
        callId,
        campaignId,
        phone,
        subscriber,
        dialDigits: typeof value?.dial_digits === "string" ? value.dial_digits : null,
        fullName: typeof value?.full_name === "string" ? value.full_name : null,
      },
    };
  } catch (error) {
    return callActionError("beginAssignedLeadCall", error, { leadId });
  }
}

/**
 * Abre la gestión que respalda una llamada manual de un ejecutivo. A
 * diferencia de `registerManualCall`, esta operación crea/reutiliza el lead y
 * la llamada abierta en una sola transacción, para que siempre exista una
 * ficha donde tipificar y cerrar el ACW correctamente.
 */
export type CallActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function callActionError<T>(context: string, error: unknown, metadata: Record<string, unknown>): CallActionResult<T> {
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
  console.error(`[calls.${context}] failed`, { ...metadata, error: message });
  return { ok: false, error: message };
}

export async function beginManualCallManagement(input: {
  campaignId: string;
  phone: string;
  contactName?: string | null;
  entryMode: "before_dial" | "after_call";
}): Promise<CallActionResult<ManualCallManagement>> {
  try {
    const { supabase } = await requireAgent();
    // Registrar una llamada que ya ocurrió ("after_call") no se bloquea: se
    // perdería el registro. Lo que no se permite es marcar.
    if (input.entryMode === "before_dial") {
      await assertNotOnDoNotCallList(supabase, { campaignId: input.campaignId, phone: input.phone });
    }
    const { data, error } = await supabase.rpc("begin_agent_manual_call_management_api", {
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
      ok: true,
      data: {
        leadId,
        callId,
        campaignId,
        leadCreated: value?.lead_created === true,
        leadReused: value?.lead_reused === true,
      },
    };
  } catch (error) {
    return callActionError("beginManualCallManagement", error, {
      campaignId: input.campaignId,
      entryMode: input.entryMode,
    });
  }
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
 * Devuelve la llamada abierta del agente actual para este lead. Este helper es
 * deliberadamente de solo lectura: un render/revalidate nunca puede iniciar
 * una gestión. Las llamadas nacen únicamente desde el evento del discador o
 * desde `begin_agent_manual_call_management`.
 */
export async function getOpenCall(leadId: string): Promise<Call | null> {
  const { supabase, userId } = await requireAgent();

  // No usamos `maybeSingle()` aquí. Hubo llamadas antiguas duplicadas antes
  // de que el CTI llevara el ciclo completo y PostgREST responde con error
  // cuando encuentra más de una fila; eso derribaba toda la ficha de cliente
  // justo al entrar una llamada. Para la operación importa la más reciente y
  // las anteriores se conservan para auditoría.
  const { data: existing, error: findError } = await supabase
    .from("calls")
    .select("*")
    .eq("lead_id", leadId)
    .eq("agent_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (findError) throw new Error(findError.message);
  return existing?.[0] ? (existing[0] as Call) : null;
}

/**
 * Devuelve la última gestión conectada y cerrada que el ejecutivo puede
 * corregir desde "Mis registros". Nunca crea una llamada ni reabre el ACW.
 */
export async function getRevisableCall(leadId: string): Promise<Call | null> {
  const { supabase, userId } = await requireAgent();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("lead_id", leadId)
    .eq("agent_id", userId)
    .eq("status", "connected")
    .not("ended_at", "is", null)
    .is("discarded_reason", null)
    .order("ended_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const latest = data?.[0] as Call | undefined;
  // Una gestión traída de Atlas 1 no se corrige: reescribirla borraría la
  // versión original, la que se concilia con Vocalcom y el histórico. Lo que
  // cambió después se registra con una gestión nueva (20260924180200).
  if (!latest || latest.legacy_call_id) return null;
  return latest;
}

/**
 * Compatibilidad explícita con la integración entrante de Vocalcom. A
 * diferencia del render de la ficha, este endpoint sí representa un evento de
 * llamada y puede iniciar la gestión. La restricción única de BD resuelve
 * carreras entre dos notificaciones del mismo evento.
 */
export async function ensureOpenCallForIncomingDialer(leadId: string): Promise<Call> {
  const { supabase, userId } = await requireAgent();
  const existing = await getOpenCall(leadId);
  if (existing) return existing;

  const { data: anotherOpen, error: openError } = await supabase
    .from("calls")
    .select("id, lead_id")
    .eq("agent_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (openError) throw new Error(openError.message);
  if (anotherOpen?.[0]) {
    throw new Error("Tienes otra gestión pendiente de tipificación.");
  }

  const { data: created, error: insertError } = await supabase
    .from("calls")
    .insert({ lead_id: leadId, agent_id: userId })
    .select("*")
    .single();
  if (!insertError && created) return created as Call;

  // Una notificación concurrente pudo insertar primero. Sólo reutilizamos la
  // llamada si corresponde al mismo evento/lead.
  const raced = await getOpenCall(leadId);
  if (raced) return raced;
  throw new Error(insertError?.message ?? "No se pudo abrir la gestión de la llamada entrante.");
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

  if (catalog.length === 0) {
    throw new Error(
      "La campaña no tiene una tipificación válida configurada. Informa a supervisión antes de cerrar."
    );
  }
  return catalog;
}

/** Guardar avance sin cerrar la llamada. */
export async function saveCallProgress(input: {
  callId: string;
  leadId: string;
  status: CallStatus | null;
  outcome: CallOutcome | null;
  reason: string | null;
  notes: string | null;
}): Promise<CallActionResult> {
  try {
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
      .eq("id", callId)
      .eq("lead_id", leadId)
      .eq("agent_id", userId)
      .is("ended_at", null)
      .select("id")
      .single();
    if (updateError) throw new Error(updateError.message);

    const { error: eventError } = await supabase.from("call_events").insert({
      call_id: callId,
      lead_id: leadId,
      agent_id: userId,
      event_type: "call.progress_updated",
      payload: { status, outcome, reason },
    });
    if (eventError) throw new Error(eventError.message);

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
    return { ok: true, data: null };
  } catch (error) {
    return callActionError("saveCallProgress", error, { callId: input.callId, leadId: input.leadId });
  }
}

/** Guardar agenda (fecha/hora de próximo contacto) sin cerrar la llamada. */
export async function saveCallAgenda(input: CallAgendaPayload): Promise<CallActionResult> {
  try {
    const { supabase, userId } = await requireAgent();
    const { callId, leadId, nextActionAt, notes } = input;
    const campaignId = await getLeadCampaignId(supabase, leadId);
    await assertIntercallBreakCompleted({ userId, campaignId });

    if (!nextActionAt || Number.isNaN(new Date(nextActionAt).getTime())) {
      throw new Error("Selecciona una fecha y hora de agenda válida.");
    }
    const slotError = agendaSlotError(nextActionAt, await fetchCampaignAgendaPolicy(supabase, campaignId));
    if (slotError) throw new Error(slotError);

    const hasConflict = await findAgendaConflict({ supabase, leadId, excludeCallId: callId, nextActionAt });
    if (hasConflict) {
      throw new Error(
        "Ya existe una agenda cerrada para este lead/contacto, en la misma campaña, para esa fecha y hora exacta."
      );
    }

    const { error } = await supabase
      .from("calls")
      .update({
        notes,
        next_action_at: nextActionAt,
        next_action_window: inferNextActionWindow(nextActionAt),
        callback_owner_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId)
      .eq("lead_id", leadId)
      .eq("agent_id", userId)
      .is("ended_at", null)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: eventError } = await supabase.from("call_events").insert({
      call_id: callId,
      lead_id: leadId,
      agent_id: userId,
      event_type: "call.agenda_saved",
      payload: {
        next_action_at: nextActionAt,
        next_action_window: inferNextActionWindow(nextActionAt),
        notes_saved: Boolean(notes),
      },
    });
    if (eventError) throw new Error(eventError.message);

    // Igual que "Guardar avance", conserva el último contexto operativo sin
    // borrar una observación previa cuando la agenda se guarda sin texto.
    if (notes) {
      const { error: leadError } = await supabase
        .from("leads")
        .update({ observacion_actual: notes })
        .eq("id", leadId);
      if (leadError) throw new Error(leadError.message);
    }

    revalidatePath(`/dashboard/leads/${leadId}`);
    revalidatePath("/dashboard/agenda");
    return { ok: true, data: null };
  } catch (error) {
    return callActionError("saveCallAgenda", error, { callId: input.callId, leadId: input.leadId });
  }
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
}): Promise<CallActionResult> {
  try {
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
    const [reasonCatalog, agendaPolicy] = await Promise.all([
      getLeadCallReasonCatalog({ supabase, lead }),
      fetchCampaignAgendaPolicy(supabase, lead.campaign_id),
    ]);

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
      reasonCatalog,
      { agendaPolicy }
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

    if (closeError) {
      // Un doble clic puede completar el primer POST antes de que llegue el
      // segundo. Si esta misma gestión ya está cerrada, el cierre es idempotente
      // y ambos clientes reciben éxito; cualquier otro error sigue siendo real.
      const { data: existingCall, error: existingError } = await supabase
        .from("calls")
        .select("lead_id, agent_id, ended_at")
        .eq("id", callId)
        .eq("lead_id", leadId)
        .eq("agent_id", userId)
        .maybeSingle();
      if (existingError || !existingCall?.ended_at) {
        throw new Error(closeError.message);
      }
      console.info("[calls.closeCall] idempotent replay", { callId, leadId, userId });
    }

    const cleanupResults = await Promise.allSettled([
      clearLegalIntercallBreak(userId),
      releaseAgentFromWrapUp(userId),
      restoreAgentFromHybridManualMode(supabase),
    ]);
    cleanupResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error("[calls.closeCall] post-close cleanup failed", {
          callId,
          leadId,
          userId,
          cleanup:
            index === 0
              ? "intercall_break"
              : index === 1
                ? "wrap_up"
                : "hybrid_manual_mode",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    // La ficha se abandona inmediatamente. Invalidarla aquí hacía que Next la
    // renderizara de nuevo antes de la navegación del cliente.
    revalidatePath("/dashboard/leads");
    return { ok: true, data: null };
  } catch (error) {
    return callActionError("closeCall", error, { callId: input.callId, leadId: input.leadId });
  }
}

/**
 * Corrige una gestión propia ya cerrada. La RPC actualiza el snapshot
 * operativo y conserva los valores anteriores en auditoría; no crea una
 * llamada ficticia ni altera el tiempo real de la conversación.
 */
export async function reviseCallManagement(input: {
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
}): Promise<CallActionResult> {
  try {
    const { supabase, userId } = await requireAgent();
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, email, workflow_id, campaign_id, managed_by")
      .eq("id", input.leadId)
      .eq("managed_by", userId)
      .single();
    if (leadError) throw new Error("El registro ya no pertenece a tu historial de gestión.");

    const { data: original, error: originalError } = await supabase
      .from("calls")
      .select("next_action_at, legacy_call_id")
      .eq("id", input.callId)
      .eq("lead_id", input.leadId)
      .eq("agent_id", userId)
      .maybeSingle();
    if (originalError) throw new Error(originalError.message);
    if (!original) throw new Error("La gestión no existe o no pertenece a tu usuario.");
    if (original.legacy_call_id) {
      throw new Error("Esta gestión viene de Atlas 1 y no se puede corregir. Registra una gestión nueva.");
    }

    const [reasonCatalog, agendaPolicy] = await Promise.all([
      getLeadCallReasonCatalog({ supabase, lead }),
      fetchCampaignAgendaPolicy(supabase, lead.campaign_id),
    ]);
    const errors = validateCallClosure(
      {
        status: input.status,
        outcome: input.outcome,
        reason: input.reason,
        notes: input.notes,
        next_action_at: input.next_action_at,
        equifax_products: input.equifax_products,
        equifax_uf_amount: input.equifax_uf_amount,
        equifax_recipient_email: input.equifax_recipient_email,
        lead_email: lead.email,
        contact_email: lead.email,
      },
      reasonCatalog,
      { agendaPolicy, previousNextActionAt: original.next_action_at }
    );
    if (errors.length > 0) throw new Error(errors.join(" "));

    const { error } = await supabase.rpc("revise_call_management", {
      p_call_id: input.callId,
      p_lead_id: input.leadId,
      p_status: input.status,
      p_outcome: input.outcome,
      p_reason: input.reason,
      p_notes: input.notes,
      p_next_action_at: input.next_action_at,
      p_equifax_products: input.equifax_products,
      p_equifax_uf_amount: input.equifax_uf_amount,
      p_equifax_recipient_email: input.equifax_recipient_email,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/dashboard/leads/${input.leadId}`);
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/agenda");
    return { ok: true, data: null };
  } catch (error) {
    return callActionError("reviseCallManagement", error, {
      callId: input.callId,
      leadId: input.leadId,
    });
  }
}

export type SupervisionManagement = {
  id: string;
  endedAt: string;
  reason: string | null;
  notes: string | null;
  agentName: string | null;
  channel: string | null;
  fromAtlas1: boolean;
};

export type LeadSupervisionContext = {
  defaultAgentId: string | null;
  agents: { id: string; name: string }[];
  managements: SupervisionManagement[];
};

/**
 * Lo que supervisión necesita en la ficha para corregir o agregar una
 * tipificación: gestiones cerradas, ejecutivos de sus equipos y a quién
 * acreditar por defecto. La RPC valida rol, empresa y equipo.
 */
export async function getLeadSupervisionContext(leadId: string): Promise<LeadSupervisionContext> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lead_supervision_context", { p_lead_id: leadId });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    default_agent_id?: string | null;
    agents?: { id: string; name: string }[];
    managements?: Record<string, unknown>[];
  };
  return {
    defaultAgentId: raw.default_agent_id ?? null,
    agents: raw.agents ?? [],
    managements: (raw.managements ?? []).map((row) => ({
      id: String(row.id),
      endedAt: String(row.ended_at),
      reason: typeof row.reason === "string" ? row.reason : null,
      notes: typeof row.notes === "string" ? row.notes : null,
      agentName: typeof row.agent_name === "string" ? row.agent_name : null,
      channel: typeof row.management_channel === "string" ? row.management_channel : null,
      fromAtlas1: row.from_atlas1 === true,
    })),
  };
}

/** Gestión cerrada que supervisión va a corregir, leída con su sesión. */
export async function getSupervisableCall(leadId: string, callId: string): Promise<Call | null> {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("id", callId)
    .eq("lead_id", leadId)
    .not("ended_at", "is", null)
    .is("discarded_reason", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Call | null) ?? null;
}

/**
 * Supervisión corrige una gestión cerrada de Atlas 2.0 (callId) o agrega una
 * tipificación nueva acreditada a un ejecutivo (callId null). Mismas reglas
 * de cierre que el ejecutivo; una venta entra sola a la validación de ventas.
 * Ver la migración 20260925050000_supervision_corrige_tipificaciones.sql.
 */
export async function superviseCallManagement(input: {
  callId: string | null;
  leadId: string;
  agentId: string | null;
  supervisorNote: string;
  status: CallStatus | null;
  outcome: CallOutcome | null;
  reason: string | null;
  notes: string | null;
  next_action_at: string | null;
  equifax_products: string[];
  equifax_uf_amount: number | null;
  equifax_recipient_email: string | null;
}): Promise<CallActionResult> {
  try {
    await requireProfile(["supervisor", "admin"]);
    const supabase = await createClient();
    if (!input.supervisorNote.trim()) throw new Error("Indica por qué corriges o agregas la tipificación.");
    if (!input.callId && !input.agentId) throw new Error("Elige a qué ejecutivo se acredita la gestión.");

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, email, workflow_id, campaign_id")
      .eq("id", input.leadId)
      .single();
    if (leadError) throw new Error("No tienes acceso a este registro.");

    const original = input.callId ? await getSupervisableCall(input.leadId, input.callId) : null;
    if (input.callId && !original) throw new Error("La gestión no existe o fue descartada.");
    if (original?.legacy_call_id) {
      throw new Error("Esta gestión viene de Atlas 1 y no se reescribe. Agrega una tipificación nueva.");
    }

    const [reasonCatalog, agendaPolicy] = await Promise.all([
      getLeadCallReasonCatalog({ supabase, lead }),
      fetchCampaignAgendaPolicy(supabase, lead.campaign_id),
    ]);
    const errors = validateCallClosure(
      {
        status: input.status,
        outcome: input.outcome,
        reason: input.reason,
        notes: input.notes,
        next_action_at: input.next_action_at,
        equifax_products: input.equifax_products,
        equifax_uf_amount: input.equifax_uf_amount,
        equifax_recipient_email: input.equifax_recipient_email,
        lead_email: lead.email,
        contact_email: lead.email,
      },
      reasonCatalog,
      { agendaPolicy, previousNextActionAt: original?.next_action_at ?? null }
    );
    if (errors.length > 0) throw new Error(errors.join(" "));

    const { error } = await supabase.rpc("supervise_call_management", {
      p_lead_id: input.leadId,
      p_call_id: input.callId,
      p_agent_id: input.callId ? null : input.agentId,
      p_status: input.status,
      p_outcome: input.outcome,
      p_reason: input.reason,
      p_notes: input.notes,
      p_next_action_at: input.next_action_at,
      p_equifax_products: input.equifax_products,
      p_equifax_uf_amount: input.equifax_uf_amount,
      p_equifax_recipient_email: input.equifax_recipient_email,
      p_supervisor_note: input.supervisorNote.trim(),
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/dashboard/leads/${input.leadId}`);
    revalidatePath("/dashboard/validacion-ventas");
    return { ok: true, data: null };
  } catch (error) {
    return callActionError("superviseCallManagement", error, {
      callId: input.callId,
      leadId: input.leadId,
    });
  }
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
      next_action_at: null,
      next_action_window: null,
      callback_owner_user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId)
    .eq("lead_id", leadId)
    .eq("agent_id", userId)
    .is("ended_at", null);
  if (error) throw new Error(error.message);

  await supabase.from("call_events").insert({
    call_id: callId,
    lead_id: leadId,
    agent_id: userId,
    event_type: "call.discarded",
    payload: { reason },
  });

  await clearLegalIntercallBreak(userId);
  await releaseAgentFromWrapUp(userId);
  await restoreAgentFromHybridManualMode(supabase);

  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}

export type OfflineManagementChannel = "whatsapp" | "correo" | "presencial" | "otro";

/**
 * Abre una gestión sin llamada: el ejecutivo contactó al cliente por otro
 * canal (WhatsApp propio, correo, presencial) y la tipifica con el mismo
 * formulario, sin volver a llamar. La base valida que el registro sea suyo y
 * que no tenga otra gestión abierta.
 */
export async function beginOfflineManagement(
  leadId: string,
  channel: OfflineManagementChannel
): Promise<CallActionResult<{ callId: string }>> {
  try {
    const { supabase } = await requireAgent();
    const { data, error } = await supabase.rpc("begin_agent_offline_management", {
      p_lead_id: leadId,
      p_channel: channel,
    });
    if (error) throw new Error(error.message);
    const value = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    if (typeof value?.call_id !== "string") throw new Error("La gestión no se pudo abrir.");
    revalidatePath(`/dashboard/leads/${leadId}`);
    return { ok: true, data: { callId: value.call_id } };
  } catch (error) {
    return callActionError("beginOfflineManagement", error, { leadId, channel });
  }
}
