"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireProfile, getCurrentProfile } from "@/lib/auth";
import type { AgentStatusReason } from "@/lib/types";

/**
 * Motivos de pausa/disponibilidad activos, para el selector de la barra CTI.
 * Cualquier usuario autenticado puede leerlos (RLS: select para
 * "authenticated").
 */
export async function listActiveStatusReasons(): Promise<AgentStatusReason[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_status_reasons")
    .select("*")
    .eq("is_active", true)
    .eq("is_system", false)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Fuerza al agente que llama a "Desconectado" (motivo de sistema, is_pause,
 * no seleccionable manualmente). Se invoca desde signOut() ANTES de cerrar
 * la sesión, así el monitor en vivo deja de mostrarlo como "Disponible" de
 * inmediato y el motor lo pausa en la cola de Asterisk en su próximo ciclo
 * (hasta 10 seg.) — sin esto, cerrar sesión no terminaba el estado
 * "Disponible" y quedaba como riesgo real de asignación de llamadas a un
 * agente que ya no está conectado.
 */
export async function markAgentLoggedOut(): Promise<void> {
  // Ojo: NO usar requireProfile() acá — se llama desde signOut() justo antes
  // de cerrar la sesión, y requireProfile() redirige a /login si no
  // encuentra perfil (ese redirect() lanza un throw especial de Next que no
  // debe quedar envuelto en un try/catch genérico). getCurrentProfile() no
  // tiene ese efecto secundario.
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "agente") return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_my_agent_logged_out");
  if (error) throw new Error(error.message);
}

/**
 * La usa el CTI cuando el navegador no puede operar el softphone (por
 * ejemplo, micrófono denegado o registro SIP perdido). Comparte la misma
 * transición de sistema que el logout para que Asterisk lo pause y el motor
 * no entregue clientes a un navegador incapaz de contestar.
 */
export async function markAgentUnavailable(): Promise<void> {
  await markAgentLoggedOut();
}

/**
 * Heartbeat del agente logueado: se llama cada ~20s mientras la pestaña del
 * CRM está abierta (ver CtiBar). El motor revisa last_heartbeat_at y fuerza
 * 'desconectado' si se vence (~60s sin heartbeat) — esto cubre el caso que
 * markAgentLoggedOut() NO cubre: cerrar la pestaña/navegador o que se
 * caiga sin pasar por el botón "Cerrar sesión".
 */
export async function heartbeat(): Promise<void> {
  const profile = await requireProfile(["agente"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_current_status")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("profile_id", profile.id);
  if (error) throw new Error(error.message);
}

/**
 * Estado actual del agente que llama (su propia fila, vía RLS
 * profile_id = auth.uid()).
 */
export async function getMyCurrentStatus(): Promise<{ reason: AgentStatusReason } | null> {
  const profile = await requireProfile(["agente"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_current_status")
    .select("reason_id, agent_status_reasons(*)")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reason = (data as any).agent_status_reasons as AgentStatusReason | null;
  return reason ? { reason } : null;
}

/**
 * El agente cambia su propio estado (Disponible o un motivo AUX concreto).
 * Se guarda en agent_current_status; el motor de discado lo lee
 * (poll ~10s) y sincroniza QueuePause en Asterisk para todas las colas en
 * las que el agente sea miembro — no hace falta tocar el servidor a mano.
 */
export async function setMyCurrentStatus(reasonId: string): Promise<void> {
  await requireProfile(["agente"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_agent_current_status", {
    p_reason_id: reasonId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Saca temporalmente al ejecutivo de sus colas automaticas para que pueda
 * originar una llamada auditada dentro de una campaña donde tiene permiso.
 */
export async function enterMyHybridManualMode(campaignId: string): Promise<void> {
  await requireProfile(["agente"]);
  if (!campaignId) throw new Error("Selecciona la campaña de la llamada manual.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("enter_agent_hybrid_manual_mode", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
}

/** Vuelve a Disponible solo si no queda llamada ni gestion manual abierta. */
export async function exitMyHybridManualMode(): Promise<void> {
  await requireProfile(["agente"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("exit_agent_hybrid_manual_mode");
  if (error) throw new Error(error.message);
}

// --- Administración de motivos (solo admin) ---

export async function listAllStatusReasons(): Promise<AgentStatusReason[]> {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_status_reasons").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createStatusReason(formData: FormData) {
  await requireProfile(["admin"]);
  const code = (formData.get("code") as string)?.trim();
  const label = (formData.get("label") as string)?.trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0);
  if (!code || !label) throw new Error("Falta código o etiqueta");

  const supabase = await createClient();
  const { error } = await supabase.from("agent_status_reasons").insert({
    code,
    label,
    is_pause: true,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/estados-agente");
}

export async function toggleStatusReasonActive(formData: FormData) {
  await requireProfile(["admin"]);
  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_status_reasons")
    .update({ is_active: !active })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/estados-agente");
}
