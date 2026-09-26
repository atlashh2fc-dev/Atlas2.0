import { supabase } from "./supabase";
export { supabase } from "./supabase";

export type AgentSipProvisioningState = {
  profileId: string;
  extension: string;
  desiredUpdatedAt: string;
  status: "synced" | "error";
  failureCode: string | null;
};

/** Persiste estado observado por extensión sin exponer credenciales SIP. */
export async function publishAgentSipProvisioningStates(
  states: AgentSipProvisioningState[],
  engineRelease: string,
): Promise<void> {
  if (states.length === 0) return;
  const { error } = await supabase.rpc("record_agent_sip_provisioning", {
    p_states: states.map((state) => ({
      profile_id: state.profileId,
      extension: state.extension,
      desired_updated_at: state.desiredUpdatedAt,
      status: state.status,
      failure_code: state.failureCode,
    })),
    p_engine_release: engineRelease,
  });
  if (error) throw new Error(`agent_sip_provisioning_status: ${error.message}`);
}

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

export type ClaimedTarget = {
  dial_attempt_id: string;
  lead_id: string;
  phone: string;
  full_name: string;
  rut: string | null;
};

export type AiVoiceCampaignConfig = {
  campaign_id: string;
  provider: "elevenlabs";
  agent_id: string;
  phone_number_id: string;
  max_concurrent_calls: number;
  max_attempts_per_contact: number;
  is_active: boolean;
  survey_schema: string | null;
};

export type AiVoiceAttempt = {
  id: string;
  campaign_id: string;
  status: string;
  provider_conversation_id: string;
  provider_call_id: string | null;
  provider_result: Record<string, unknown>;
};

export type AiVoiceTestCall = {
  id: string;
  campaign_id: string;
  status: string;
  provider_conversation_id: string;
  provider_call_id: string | null;
  provider_result: Record<string, unknown>;
};

export type ClaimedAiVoiceTestCall = {
  test_call_id: string;
  campaign_id: string;
  phone: string;
  contact_name: string;
  agent_id: string;
  phone_number_id: string;
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

export async function getActiveAiVoiceCampaignConfigs(
  campaignIds: string[]
): Promise<AiVoiceCampaignConfig[]> {
  if (campaignIds.length === 0) return [];
  const { data, error } = await supabase
    .from("ai_voice_campaign_configs")
    .select("campaign_id,provider,agent_id,phone_number_id,max_concurrent_calls,max_attempts_per_contact,is_active,survey_schema")
    .in("campaign_id", campaignIds)
    .eq("is_active", true)
    .not("phone_number_id", "is", null);
  if (error) throw new Error(`ai_voice_campaign_configs: ${error.message}`);
  return (data ?? []) as AiVoiceCampaignConfig[];
}

export async function claimNextAiVoiceTargets(
  campaignId: string,
  batchSize: number
): Promise<ClaimedTarget[]> {
  if (batchSize <= 0) return [];
  const { data, error } = await supabase.rpc("claim_next_ai_voice_targets", {
    p_campaign_id: campaignId,
    p_batch_size: batchSize,
  });
  if (error) throw new Error(`claim_next_ai_voice_targets: ${error.message}`);
  return (data ?? []) as ClaimedTarget[];
}

export async function getActiveAiVoiceAttempts(campaignId: string): Promise<AiVoiceAttempt[]> {
  const { data, error } = await supabase
    .from("dial_attempts")
    .select("id,campaign_id,status,provider_conversation_id,provider_call_id,provider_result")
    .eq("campaign_id", campaignId)
    .eq("attempt_kind", "ai_voice")
    .not("provider_conversation_id", "is", null)
    .in("status", ["originating", "ringing", "answered", "bridged"]);
  if (error) throw new Error(`dial_attempts (ai active): ${error.message}`);
  return (data ?? []) as AiVoiceAttempt[];
}

export async function registerAiVoiceEvent(params: {
  dialAttemptId: string;
  status: string;
  providerConversationId?: string | null;
  providerCallId?: string | null;
  result?: Record<string, unknown>;
  hangupCause?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("register_ai_voice_event", {
    p_dial_attempt_id: params.dialAttemptId,
    p_status: params.status,
    p_provider_conversation_id: params.providerConversationId ?? null,
    p_provider_call_id: params.providerCallId ?? null,
    p_result: params.result ?? {},
    p_hangup_cause: params.hangupCause ?? null,
  });
  if (error) throw new Error(`register_ai_voice_event: ${error.message}`);
}

export async function claimNextAiVoiceTestCalls(
  campaignIds: string[],
  batchSize: number
): Promise<ClaimedAiVoiceTestCall[]> {
  if (campaignIds.length === 0 || batchSize <= 0) return [];
  const { data, error } = await supabase.rpc("claim_next_ai_voice_test_calls", {
    p_campaign_ids: campaignIds,
    p_batch_size: batchSize,
  });
  if (error) throw new Error(`claim_next_ai_voice_test_calls: ${error.message}`);
  return (data ?? []) as ClaimedAiVoiceTestCall[];
}

export async function getActiveAiVoiceTestCalls(campaignIds: string[]): Promise<AiVoiceTestCall[]> {
  if (campaignIds.length === 0) return [];
  const { data, error } = await supabase
    .from("ai_voice_test_calls")
    .select("id,campaign_id,status,provider_conversation_id,provider_call_id,provider_result")
    .in("campaign_id", campaignIds)
    .not("provider_conversation_id", "is", null)
    .in("status", ["originating", "ringing", "answered"]);
  if (error) throw new Error(`ai_voice_test_calls (active): ${error.message}`);
  return (data ?? []) as AiVoiceTestCall[];
}

export async function registerAiVoiceTestCallEvent(params: {
  testCallId: string;
  status: string;
  providerConversationId?: string | null;
  providerCallId?: string | null;
  result?: Record<string, unknown>;
  hangupCause?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("register_ai_voice_test_call_event", {
    p_test_call_id: params.testCallId,
    p_status: params.status,
    p_provider_conversation_id: params.providerConversationId ?? null,
    p_provider_call_id: params.providerCallId ?? null,
    p_result: params.result ?? {},
    p_hangup_cause: params.hangupCause ?? null,
  });
  if (error) throw new Error(`register_ai_voice_test_call_event: ${error.message}`);
}

export async function registerDialEvent(params: {
  dialAttemptId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  agentId?: string | null;
  amiUniqueId?: string | null;
  amiChannel?: string | null;
  hangupCause?: string | null;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc("register_dial_event", {
    p_dial_attempt_id: params.dialAttemptId,
    p_event_type: params.eventType,
    p_payload: params.payload ?? {},
    p_agent_id: params.agentId ?? null,
    p_ami_unique_id: params.amiUniqueId ?? null,
    p_ami_channel: params.amiChannel ?? null,
    p_hangup_cause: params.hangupCause ?? null,
  });
  if (error) throw new Error(`register_dial_event: ${error.message}`);
  return typeof data === "string" ? data : null;
}

/**
 * Deja en dial_attempts.caller_id el número que se mostró en cada intento,
 * para medir la contactabilidad por número. Un solo viaje por lote.
 */
export async function recordDialAttemptCallerIds(
  items: Array<{ dialAttemptId: string; callerId: string }>
): Promise<number> {
  if (items.length === 0) return 0;
  const { data, error } = await supabase.rpc("record_dial_attempt_caller_ids", {
    p_attempt_ids: items.map((item) => item.dialAttemptId),
    p_caller_ids: items.map((item) => item.callerId),
  });
  if (error) throw new Error(`record_dial_attempt_caller_ids: ${error.message}`);
  return typeof data === "number" ? data : 0;
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
 * Confirma al ejecutivo que Asterisk efectivamente conectó. Devuelve `false`
 * si el intento ya terminó y no debe reabrirse.
 */
export async function confirmDialAttemptAgent(dialAttemptId: string, agentId: string): Promise<boolean> {
  // AgentConnect es la primera señal autoritativa de quién atendió. La RPC
  // mantiene intento, lead y asignación en una sola transacción y puede
  // corregir una oferta provisional creada por una versión anterior del motor.
  const { data, error } = await supabase.rpc("confirm_dial_attempt_agent_connection", {
    p_dial_attempt_id: dialAttemptId,
    p_agent_id: agentId,
  });
  if (error) throw new Error(`confirm_dial_attempt_agent_connection: ${error.message}`);
  return data === true;
}

/**
 * Evento de screen-pop consumido por DialerListener en el layout de Atlas.
 * Se emite después de AgentConnect, cuando Queue ya confirmó al agente real.
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
  status: "offline" | "available" | "ringing" | "on_call" | "wrap_up" | "paused" | "pausing";
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

  // Un ejecutivo al que le está sonando (o ya habla) su agenda personal sigue
  // figurando 'available' hasta que conecta. Si contara, el pool originaría
  // para él y el cliente del pool quedaría esperando en la cola sin nadie.
  const { data: callbackAttempts, error: callbackAttemptsError } = await supabase
    .from("dial_attempts")
    .select("agent_id")
    .eq("attempt_kind", "personal_callback")
    .in("status", ["queued", "originating", "ringing", "answered", "bridged"])
    .in(
      "agent_id",
      availableSessions.map((session) => session.profile_id)
    )
    .gte("created_at", openCallsSince);
  if (callbackAttemptsError) {
    throw new Error(`dial_attempts (agendas en vuelo): ${callbackAttemptsError.message}`);
  }

  // Quien eligió un AUX no es capacidad aunque su sesión diga 'available'
  // (p. ej. lo eligió durante el cierre: Asterisk ya lo tenía pausado y no
  // hubo evento que corrigiera la sesión). Contarlo hacía que el predictivo
  // originara clientes para nadie o se los cargara al resto del equipo.
  const { data: currentStatuses, error: currentStatusesError } = await supabase
    .from("agent_current_status")
    .select("profile_id, agent_status_reasons(is_pause)")
    .in(
      "profile_id",
      availableSessions.map((session) => session.profile_id)
    );
  if (currentStatusesError) {
    throw new Error(`agent_current_status (disponibles): ${currentStatusesError.message}`);
  }
  const pausedAgents = (currentStatuses ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((status) => (status as any).agent_status_reasons?.is_pause === true)
    .map((status) => status.profile_id);

  const busyAgents = new Set([
    ...(openCalls ?? []).map((call) => call.agent_id),
    ...(callbackAttempts ?? []).map((attempt) => attempt.agent_id),
    ...pausedAgents,
  ]);
  return availableSessions.filter(
    (session) => !busyAgents.has(session.profile_id)
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
 * Tasa de abandono (porcentaje: 3 = 3 %) de los intentos del pool en los
 * últimos `windowMinutes`: de los que el cliente contestó, cuántos nunca
 * llegaron a una ejecutiva. Devuelve null si no hay volumen todavía (campaña
 * recién arrancada), para que el ajuste de ratio predictivo sepa que no debe
 * confiar en el número.
 *
 * "Contestó" es originated_at no nulo: el pool origina con Async y Asterisk
 * solo manda OriginateResponse Success (que es lo que llena originated_at)
 * cuando la pata del cliente contesta. Antes el denominador era answered_at,
 * que casi nunca se llenaba: la función devolvía null y el predictivo crecía
 * "sin señal" aunque estuviera dejando gente colgada. Solo el pool: en una
 * agenda personal originated_at es el ejecutivo contestando, y las agendas no
 * las regula el ratio.
 */
export async function getRecentAbandonmentRate(campaignId: string, windowMinutes: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const [answered, abandoned] = await Promise.all([
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .not("originated_at", "is", null)
      .gte("originated_at", since),
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .eq("status", "abandoned")
      .gte("originated_at", since),
  ]);
  if (answered.error) throw new Error(`dial_attempts (contestados): ${answered.error.message}`);
  if (abandoned.error) throw new Error(`dial_attempts (abandonados): ${abandoned.error.message}`);
  const answeredCount = answered.count ?? 0;
  if (answeredCount === 0) return null;
  return ((abandoned.count ?? 0) / answeredCount) * 100;
}

/** Intentos terminados mínimos para que la tasa de contacto sea una señal y no ruido. */
const CONTACT_RATE_MIN_SAMPLE = 15;

/**
 * Fracción (0..1) de los intentos del pool terminados en la ventana que
 * llegaron a conversación con un ejecutivo. Es la señal con la que el modo
 * predictivo decide cuántas líneas por ejecutivo libre necesita: con 12 % de
 * contacto, una línea por ejecutivo deja a la persona esperando ~8 intentos.
 * Devuelve null si todavía no hay muestra suficiente.
 */
export async function getRecentContactRate(campaignId: string, windowMinutes: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const [terminal, bridged] = await Promise.all([
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .not("ended_at", "is", null)
      .gte("ended_at", since),
    supabase
      .from("dial_attempts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("attempt_kind", "pool")
      .not("ended_at", "is", null)
      .not("bridged_at", "is", null)
      .gte("ended_at", since),
  ]);
  if (terminal.error) throw new Error(`dial_attempts (terminados): ${terminal.error.message}`);
  if (bridged.error) throw new Error(`dial_attempts (conectados): ${bridged.error.message}`);
  const total = terminal.count ?? 0;
  if (total < CONTACT_RATE_MIN_SAMPLE) return null;
  return (bridged.count ?? 0) / total;
}

/**
 * Estado actual de las sesiones de discado de un ejecutivo. Lo usa la
 * liberación por evento para confirmar que la tipificación ya lo dejó
 * 'available' antes de despausarlo en Asterisk.
 */
export async function getAgentSessionStatuses(profileId: string): Promise<Array<{ campaign_id: string; status: string }>> {
  const { data, error } = await supabase
    .from("dialer_agent_sessions")
    .select("campaign_id, status")
    .eq("profile_id", profileId);
  if (error) throw new Error(`dialer_agent_sessions (por ejecutivo): ${error.message}`);
  return data ?? [];
}

/**
 * true si el ejecutivo eligió un motivo de pausa (AUX) desde la barra CTI.
 * La liberación por evento no debe despausarlo en Asterisk en ese caso aunque
 * su sesión de discado diga 'available'.
 */
export async function isAgentInPauseReason(profileId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("agent_current_status")
    .select("profile_id, agent_status_reasons(is_pause)")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`agent_current_status (por ejecutivo): ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reason = (data as any)?.agent_status_reasons as { is_pause: boolean } | null | undefined;
  return reason?.is_pause === true;
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

export type AgentHybridManualRequest = {
  request_id: string;
  profile_id: string;
  extension: string;
};

export async function claimAgentHybridManualRequests(
  workerId: string,
  limit = 5
): Promise<AgentHybridManualRequest[]> {
  const { data, error } = await supabase.rpc("claim_agent_hybrid_manual_requests", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim_agent_hybrid_manual_requests: ${error.message}`);
  return (data ?? []) as AgentHybridManualRequest[];
}

export async function completeAgentHybridManualRequest(params: {
  requestId: string;
  success: boolean;
  error?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("complete_agent_hybrid_manual_request", {
    p_request_id: params.requestId,
    p_success: params.success,
    p_error: params.error ?? null,
  });
  if (error) throw new Error(`complete_agent_hybrid_manual_request: ${error.message}`);
}

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

  const profileIds = creds.map((c) => c.profile_id);
  const [statusResult, sessionResult] = await Promise.all([
    supabase
      .from("agent_current_status")
      .select("profile_id, agent_status_reasons(label, is_pause)")
      .in("profile_id", profileIds),
    supabase
      .from("dialer_agent_sessions")
      .select("profile_id, status")
      .in("profile_id", profileIds)
      .eq("status", "wrap_up"),
  ]);
  if (statusResult.error) throw new Error(`agent_current_status: ${statusResult.error.message}`);
  if (sessionResult.error) throw new Error(`dialer_agent_sessions: ${sessionResult.error.message}`);

  const statusByProfile = new Map(
    (statusResult.data ?? []).map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (s as any).agent_status_reasons as { label: string; is_pause: boolean } | null;
      return [s.profile_id, reason];
    })
  );
  const wrapUpProfiles = new Set((sessionResult.data ?? []).map((s) => s.profile_id));

  return creds.map((c) => {
    const reason = statusByProfile.get(c.profile_id) ?? null;
    const inWrapUp = wrapUpProfiles.has(c.profile_id);
    return {
      extension: c.extension,
      paused: inWrapUp || (reason?.is_pause ?? false),
      reasonLabel: inWrapUp ? "Cierre y tipificación" : (reason?.label ?? null),
    };
  });
}
