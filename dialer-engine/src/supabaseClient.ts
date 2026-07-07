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

export async function updateAgentDialerStatus(params: {
  profileId: string;
  campaignId: string;
  extension: string;
  status: "offline" | "available" | "ringing" | "on_call" | "wrap_up";
}) {
  const { error } = await supabase.rpc("update_agent_dialer_status", {
    p_profile_id: params.profileId,
    p_campaign_id: params.campaignId,
    p_extension: params.extension,
    p_status: params.status,
  });
  if (error) throw new Error(`update_agent_dialer_status: ${error.message}`);
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
  const { count, error } = await supabase
    .from("dialer_agent_sessions")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "available");
  if (error) throw new Error(`dialer_agent_sessions: ${error.message}`);
  return count ?? 0;
}

export async function countInFlightAttempts(campaignId: string): Promise<number> {
  const { count, error } = await supabase
    .from("dial_attempts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "originating", "ringing", "answered"]);
  if (error) throw new Error(`dial_attempts: ${error.message}`);
  return count ?? 0;
}

/**
 * Extensiones activas de los agentes asignados a una campaña
 * (campaign_agents ∩ agent_sip_credentials activas). Es la fuente de verdad
 * para qué debe ser miembro de la queue de esa campaña — asignar/quitar un
 * agente desde /dashboard/admin/campanas/[id] alcanza para que el motor
 * actualice la cola en Asterisk, sin tocar nada a mano.
 */
export async function getCampaignAgentExtensions(campaignId: string): Promise<string[]> {
  // Dos consultas en vez de un embed PostgREST: campaign_agents y
  // agent_sip_credentials no tienen una FK directa entre sí (ambas apuntan a
  // profiles por separado), así que "agent_sip_credentials!inner(...)" no
  // resuelve ("Could not find a relationship..."). Esto es más verboso pero
  // no depende de que PostgREST adivine una relación que no existe.
  const { data: members, error: membersError } = await supabase
    .from("campaign_agents")
    .select("profile_id")
    .eq("campaign_id", campaignId);
  if (membersError) throw new Error(`campaign_agents: ${membersError.message}`);

  const profileIds = (members ?? []).map((m) => m.profile_id);
  if (profileIds.length === 0) return [];

  const { data: creds, error: credsError } = await supabase
    .from("agent_sip_credentials")
    .select("extension")
    .in("profile_id", profileIds)
    .eq("is_active", true);
  if (credsError) throw new Error(`agent_sip_credentials: ${credsError.message}`);

  return (creds ?? []).map((c) => c.extension);
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

/**
 * Estado de pausa (Auxiliar/Baño/Capacitación/etc.) de cada agente con
 * extensión activa, para sincronizar QueuePause en Asterisk. La relación
 * agent_current_status -> agent_status_reasons SÍ tiene FK directa (a
 * diferencia de campaign_agents/agent_sip_credentials), así que el embed
 * PostgREST funciona en una sola consulta.
 */
export async function getAgentPauseStates(): Promise<AgentPauseState[]> {
  const { data: creds, error: credsError } = await supabase
    .from("agent_sip_credentials")
    .select("profile_id, extension")
    .eq("is_active", true);
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
