"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";

/**
 * Estado en vivo de todos los ejecutivos (rol agente) para el monitor de
 * supervisión. La función devuelve sólo los datos operativos (nunca la clave
 * SIP) y puede acceder a la extensión aun cuando las credenciales completas
 * estén protegidas por RLS.
 */
export async function getAgentLiveStatus(): Promise<AgentLiveStatus[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_agent_live_status");
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentLiveStatus[];
}

/**
 * Salud de cola por campaña activa (llamadas en curso + contadores del día).
 * get_queue_health ya valida admin/supervisor internamente (SECURITY
 * DEFINER), pero repetimos el check acá para no depender solo de eso.
 */
export async function getQueueHealth(): Promise<QueueHealth[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_queue_health");
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueHealth[];
}
