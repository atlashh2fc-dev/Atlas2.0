import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "./config";

/**
 * Cliente único con la service_role key. Bypassa RLS y es el único que puede
 * ejecutar claim_next_dial_targets / register_dial_event /
 * update_agent_dialer_status (revocadas para authenticated/anon en la
 * migración 20260702203624_dialer_engine_foundation.sql).
 *
 * Este proceso NUNCA debe recibir ni usar tokens de sesión de agentes.
 *
 * El motor no usa Realtime, pero supabase-js inicializa el RealtimeClient al
 * crear el cliente y en Node < 22 no hay WebSocket global — hay que
 * inyectarlo explícitamente via `ws` o el cliente revienta al arrancar.
 */
/**
 * Ventana para considerar "en curso" una llamada sin cerrar. Más allá de esto
 * la fila es huérfana (caída del navegador o del proceso) y no debe seguir
 * consumiendo la capacidad del ejecutivo.
 */
const OPEN_CALL_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const STALE_QUEUED_SECONDS = 5 * 60;

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as never },
});

export type ClaimedTarget = {
  dial_attempt_id: string;
  lead_id: string;
  phone: string;
  full_name: string;
  rut: string | null;
};

export async function claimNextDialTargets(campaignId: string, batchSize: number): Promise<ClaimedTarget[]> {
  if (batchSize <= 0) return [];
  const { data, error } = await supabase.rpc("claim_next_dial_targets", {
    p_campaign_id: campaignId,
    p_batch_size: batchSize,
  });
  if (error) throw new Error(`claim_next_dial_targets: ${error.message}`);
  return data ?? [];
}

export async function registerDialEvent(params: {
  dialAttemptId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  agentId?: string | null;
  amiUniqueId?: string | null;
  amiChannel?: string | null;
  hangupCause?: string | null;
}) {
  const { error } = await supabase.rpc("register_dial_event", {
    p_dial_attempt_id: params.dialAttemptId,
    p_event_type: params.eventType,
    p_payload: params.payload ?? {},
    p_agent_id: params.agentId ?? null,
    p_ami_unique_id: params.amiUniqueId ?? null,
    p_ami_channel: params.amiChannel ?? null,
    p_hangup_cause: params.hangupCause ?? null,
  });
  if (error) throw new Error(`register_dial_event: ${error.message}`);
}

/**
 * Recupera reservas que nunca recibieron respuesta AMI. Solo toca `queued`:
 * una llamada que ya tiene canal/originated_at necesita reconciliación con
 * Asterisk y no se puede expirar por tiempo a ciegas.
 */
export async function expireStaleQueuedDialAttempts(
  campaignId: string,
  olderThanSeconds = STALE_QUEUED_SECONDS
): Promise<number> {
  const { data, error } = await supabase.rpc("expire_stale_queued_dial_attempts", {
    p_campaign_id: campaignId,
    p_older_than_seconds: olderThanSeconds,
  });
  if (error) throw new Error(`expire_stale_queued_dial_attempts: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

/**
 * AgentCalled ocurre antes de que el navegador reciba el INVITE de Queue.
 * Asociar el intento en ese punto permite que el CTI cargue la ficha exacta
 * mientras contesta automáticamente, sin adivinar por teléfono o campaña.
 */
/**
 * Asigna el intento al ejecutivo seleccionado por Queue. Devuelve `false` si
 * el evento llegó duplicado o el intento ya fue tomado/terminalizado.
 */
export async function assignDialAttemptAgent(dialAttemptId: string, agentId: string): Promise<boolean> {
  // Una sola operación en la base: sin esto quedaba un instante con el intento
  // tomado y el registro todavía en manos de otro ejecutivo, que era justo la
  // ventana en que el screen-pop y la tipificación se bloqueaban.
  const { data, error } = await supabase.rpc("claim_dial_attempt_for_agent", {
    p_dial_attempt_id: dialAttemptId,
    p_agent_id: agentId,
  });
  if (error) throw new Error(`claim_dial_attempt_for_agent: ${error.message}`);
  return data === true;
}

/**
 * Evento de screen-pop consumido por DialerListener en el layout de Atlas.
 * Se emite cuando Queue selecciona al agente, antes del bridge, para abrir
 * la ficha y la tipificación mientras el CTI contesta el INVITE.
 */
export async function emitIncomingDialEvent(dialAttemptId: string, agentId: string) {
  const { data: attempt, error: attemptError } = await supabase
    .from("dial_attempts")
    .select("lead_id, campaign_id, phone")
    .eq("id", dialAttemptId)
    .single();
  if (attemptError) throw new Error(`dial_attempts (screen-pop): ${attemptError.message}`);

  const { error } = await supabase.from("call_events").insert({
    call_id: null,
    lead_id: attempt.lead_id,
    agent_id: agentId,
    event_type: "dialer.incoming_call",
    payload: {
      dial_attempt_id: dialAttemptId,
      campaign_id: attempt.campaign_id,
      phone: attempt.phone,
      source: "asterisk_engine",
    },
  });
  if (error) throw new Error(`call_events (screen-pop): ${error.message}`);
}

export async function updateAgentDialerStatus(params: {
  profileId: string;
  campaignId: string;
  extension: string;
  status: "offline" | "available" | "ringing" | "on_call" | "wrap_up" | "paused";
}) {
  // Los eventos genéricos de QueueMember pueden informar "disponible"
  // después de AgentComplete. No deben sacar al ejecutivo de wrap-up: esa
  // transición la hace Atlas únicamente al guardar/cerrar la tipificación.
  if (params.status === "available") {
    const { data: current, error: currentError } = await supabase
      .from("dialer_agent_sessions")
      .select("status")
      .eq("profile_id", params.profileId)
      .eq("campaign_id", params.campaignId)
      .maybeSingle();
    if (currentError) throw new Error(`dialer_agent_sessions (current): ${currentError.message}`);
    if (current?.status === "wrap_up") return;
  }

  const { error } = await supabase.rpc("update_agent_dialer_status", {
    p_profile_id: params.profileId,
    p_campaign_id: params.campaignId,
    p_extension: params.extension,
    p_status: params.status,
  });
  if (error) throw new Error(`update_agent_dialer_status: ${error.message}`);
}

export type DuePersonalCallback = {
  dial_attempt_id: string;
  lead_id: string;
  phone: string;
  full_name: string;
  rut: string | null;
  agent_id: string;
  agent_extension: string;
};

/**
 * Compromisos agendados que ya vencieron y cuyo ejecutivo está conectado y
 * libre. El intento nace reservado a esa persona: ningún otro puede tomarlo.
 */
export async function claimDuePersonalCallbacks(
  campaignId: string,
  limit: number
): Promise<DuePersonalCallback[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase.rpc("claim_due_personal_callbacks", {
    p_campaign_id: campaignId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim_due_personal_callbacks: ${error.message}`);
  return (data ?? []) as DuePersonalCallback[];
}

/**
 * Compromisos que se pasaron de la ventana de entrega. Según la política de la
 * campaña quedan vencidos en la agenda del ejecutivo o se sueltan al pool.
 */
export async function expirePersonalCallbacks(campaignId: string): Promise<number> {
  const { data, error } = await supabase.rpc("expire_personal_callbacks", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`expire_personal_callbacks: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

export async function getActiveCampaignConfigs(campaignIds: string[]) {
  const { data, error } = await supabase
    .from("dialer_campaign_configs")
    .select("*")
    .in("campaign_id", campaignIds)
    .eq("is_active", true);
  if (error) throw new Error(`dialer_campaign_configs: ${error.message}`);
  return data ?? [];
}

export async function countAvailableAgents(campaignId: string): Promise<number> {
  // Un agente multiskill solo cuenta para esta cola dentro de su franja. Esto
  // evita originar llamadas cuando la sincronización ya lo quitó de la cola.
  const extensions = await getCampaignAgentExtensions(campaignId);
  if (extensions.length === 0) return 0;
  const { data: availableSessions, error } = await supabase
    .from("dialer_agent_sessions")
    .select("profile_id, extension")
    .eq("campaign_id", campaignId)
    .eq("status", "available")
    .in("extension", extensions);
  if (error) throw new Error(`dialer_agent_sessions: ${error.message}`);
  if (!availableSessions || availableSessions.length === 0) return 0;

  // Defensa adicional contra carreras entre Hangup/AgentComplete: mientras
  // exista una llamada abierta para tipificar, ese agente no tiene capacidad
  // aunque una sesión atrasada todavía diga "available".
  // Solo llamadas abiertas recientes: una fila que quedó sin cerrar por una
  // caída dejaba al ejecutivo sin capacidad para siempre y, con todos en esa
  // situación, el discador se quedaba en cero llamadas.
  const openCallsSince = new Date(Date.now() - OPEN_CALL_MAX_AGE_MS).toISOString();
  const { data: openCalls, error: openCallsError } = await supabase
    .from("calls")
    .select("agent_id")
    .in(
      "agent_id",
      availableSessions.map((session) => session.profile_id)
    )
    .is("ended_at", null)
    .gte("started_at", openCallsSince);
  if (openCallsError) throw new Error(`calls (open by agent): ${openCallsError.message}`);

  const agentsWithOpenCalls = new Set((openCalls ?? []).map((call) => call.agent_id));
  return availableSessions.filter(
    (session) => !agentsWithOpenCalls.has(session.profile_id)
  ).length;
}

export async function countInFlightAttempts(campaignId: string): Promise<number> {
  const queuedCutoff = new Date(Date.now() - STALE_QUEUED_SECONDS * 1000).toISOString();
  const [active, freshQueued] = await Promise.all([
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .in("status", ["originating", "ringing", "answered", "bridged"]),
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .eq("status", "queued")
      .gte("created_at", queuedCutoff),
  ]);
  if (active.error) throw new Error(`dial_attempts (active): ${active.error.message}`);
  if (freshQueued.error) throw new Error(`dial_attempts (fresh queued): ${freshQueued.error.message}`);
  return (active.count ?? 0) + (freshQueued.count ?? 0);
}

/**
 * Extensiones activas de los agentes asignados a una campaña dentro de su
 * franja multiskill. Es la fuente de verdad para qué debe ser miembro de la
 * queue — la asignación y sus horarios se sincronizan desde el CRM, sin tocar
 * Asterisk a mano.
 */
export async function getCampaignAgentExtensions(campaignId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_active_campaign_agent_extensions", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`get_active_campaign_agent_extensions: ${error.message}`);
  return ((data ?? []) as { extension: string }[]).map((member) => member.extension);
}

/**
 * Tasa de abandono medida en los últimos `windowMinutes` (contestadas por el
 * cliente vs. abandonadas — cliente contestó y nunca llegó a bridgearse con
 * un agente). Devuelve null si no hay volumen suficiente todavía (campaña
 * recién arrancada), para que el ajuste de ratio predictivo sepa que no debe
 * confiar en el número y arranque conservador.
 */
export async function getRecentAbandonmentRate(campaignId: string, windowMinutes: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { count: answeredCount, error: answeredError } = await supabase
    .from("dial_attempts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .not("answered_at", "is", null)
    .gte("originated_at", since);
  if (answeredError) throw new Error(`dial_attempts (answered): ${answeredError.message}`);
  if (!answeredCount || answeredCount === 0) return null;

  const { count: abandonedCount, error: abandonedError } = await supabase
    .from("dial_attempts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "abandoned")
    .gte("originated_at", since);
  if (abandonedError) throw new Error(`dial_attempts (abandoned): ${abandonedError.message}`);

  return ((abandonedCount ?? 0) / answeredCount) * 100;
}

const HEARTBEAT_GRACE_SECONDS = 60;

/**
 * Cubre el gap que markAgentLoggedOut() (CRM) no cubre: cerrar la
 * pestaña/navegador o que se caiga sin pasar por "Cerrar sesión" nunca
 * llama a signOut(), así que agent_current_status queda en el último
 * motivo (típicamente "Disponible") para siempre. El CRM manda un
 * heartbeat cada ~20s (ver cti-bar.tsx) mientras la pestaña sigue abierta;
 * si un agente lleva más de HEARTBEAT_GRACE_SECONDS sin uno (o nunca mandó
 * ninguno, pasado el mismo margen desde que arrancó su estado actual), se
 * lo fuerza a 'desconectado' — mismo motivo y mecanismo que usa el CRM al
 * cerrar sesión explícitamente, así el wallboard y el resto de reportes ni
 * se enteran de la diferencia.
 */
export async function expireStaleAgentHeartbeats(): Promise<string[]> {
  const { data: reason, error: reasonError } = await supabase
    .from("agent_status_reasons")
    .select("id")
    .eq("code", "desconectado")
    .maybeSingle();
  if (reasonError) throw new Error(`agent_status_reasons: ${reasonError.message}`);
  if (!reason) return []; // migración no aplicada aún; no bloquear el ciclo por esto.

  const cutoff = new Date(Date.now() - HEARTBEAT_GRACE_SECONDS * 1000).toISOString();

  const { data: stale, error: staleError } = await supabase
    .from("agent_current_status")
    .select("profile_id")
    .neq("reason_id", reason.id)
    .lt("since", cutoff)
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoff}`);
  if (staleError) throw new Error(`agent_current_status (select): ${staleError.message}`);
  if (!stale || stale.length === 0) return [];

  const profileIds = stale.map((s) => s.profile_id);
  const { error: updateError } = await supabase
    .from("agent_current_status")
    .update({ reason_id: reason.id, since: new Date().toISOString() })
    .in("profile_id", profileIds);
  if (updateError) throw new Error(`agent_current_status (update): ${updateError.message}`);

  return profileIds;
}

export type AgentPauseState = { extension: string; paused: boolean; reasonLabel: string | null };

export type AgentControlCommand = {
  command_id: string;
  profile_id: string;
  extension: string;
  sip_password: string;
  previous_phone_status: string | null;
  reason: string | null;
};

export async function claimAgentControlCommands(
  workerId: string,
  limit = 5
): Promise<AgentControlCommand[]> {
  const { data, error } = await supabase.rpc("claim_agent_control_commands", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim_agent_control_commands: ${error.message}`);
  return (data ?? []) as AgentControlCommand[];
}

export async function completeAgentControlCommand(params: {
  commandId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("complete_agent_control_command", {
    p_command_id: params.commandId,
    p_success: params.success,
    p_result: params.result ?? {},
    p_error: params.error ?? null,
  });
  if (error) throw new Error(`complete_agent_control_command: ${error.message}`);
}

/**
 * Estado de pausa (Auxiliar/Baño/Capacitación/etc.) de cada agente con
 * extensión activa, para sincronizar QueuePause en Asterisk. La relación
 * agent_current_status -> agent_status_reasons SÍ tiene FK directa (a
 * diferencia de campaign_agents/agent_sip_credentials), así que el embed
 * PostgREST funciona en una sola consulta.
 */
export async function getAgentPauseStates(): Promise<AgentPauseState[]> {
  const { data: activeCampaigns, error: campaignError } = await supabase
    .from("dialer_campaign_configs")
    .select("campaign_id")
    .eq("is_active", true);
  if (campaignError) throw new Error(`dialer_campaign_configs: ${campaignError.message}`);
  if (!activeCampaigns || activeCampaigns.length === 0) return [];

  const activeExtensionResults = await Promise.all(
    activeCampaigns.map((campaign) =>
      getCampaignAgentExtensions(campaign.campaign_id)
    )
  );
  const activeExtensions = Array.from(new Set(activeExtensionResults.flat()));
  if (activeExtensions.length === 0) return [];

  const { data: creds, error: credsError } = await supabase
    .from("agent_sip_credentials")
    .select("profile_id, extension")
    .eq("is_active", true)
    .in("extension", activeExtensions);
  if (credsError) throw new Error(`agent_sip_credentials: ${credsError.message}`);
  if (!creds || creds.length === 0) return [];

  const { data: statuses, error: statusError } = await supabase
    .from("agent_current_status")
    .select("profile_id, agent_status_reasons(label, is_pause)")
    .in(
      "profile_id",
      creds.map((c) => c.profile_id)
    );
  if (statusError) throw new Error(`agent_current_status: ${statusError.message}`);

  const statusByProfile = new Map(
    (statuses ?? []).map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (s as any).agent_status_reasons as { label: string; is_pause: boolean } | null;
      return [s.profile_id, reason];
    })
  );

  return creds.map((c) => {
    const reason = statusByProfile.get(c.profile_id) ?? null;
    return {
      extension: c.extension,
      paused: reason?.is_pause ?? false,
      reasonLabel: reason?.label ?? null,
    };
  });
}
