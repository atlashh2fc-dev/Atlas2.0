"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";
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

/**
 * Cierra las sesiones actuales de un ejecutivo sin desactivar su cuenta ni
 * alterar campañas, cartera o extensión. La RPC deja la orden durable para
 * navegador y motor PBX; el monitor muestra sus confirmaciones por separado.
 */
export async function forceAgentLogout(
  profileId: string,
  reason?: string
): Promise<{ commandId: string }> {
  await requireProfile(["admin"]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    throw new Error("Ejecutivo inválido.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("force_agent_logout", {
    p_target_profile_id: profileId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("La orden de cierre no devolvió un identificador.");

  revalidatePath("/dashboard/supervision/monitor");
  return { commandId: data };
}
