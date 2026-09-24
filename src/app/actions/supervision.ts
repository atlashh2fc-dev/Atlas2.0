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
 * El supervisor solo puede cerrar a ejecutivos de los equipos que supervisa;
 * esa frontera la aplica force_agent_logout.
 */
export async function forceAgentLogout(
  profileId: string,
  reason?: string
): Promise<{ commandId: string }> {
  await requireProfile(["admin", "supervisor"]);
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

export type LiveWallboard = {
  generado: string;
  estado: {
    total: number;
    conectados: number;
    disponibles: number;
    hablando: number;
    timbrando: number;
    wrap_up: number;
    en_pausa: number;
    desconectados: number;
    pausa_por_motivo: { motivo: string; ejecutivos: number }[];
  };
  hoy: {
    gestiones: number;
    contactos: number;
    contactabilidad: number | null;
    tmo_segundos: number | null;
    tmo_contacto_segundos: number | null;
    ventas: number;
    cotizaciones: number;
    agendas: number;
    discador_intentos: number;
    discador_conectadas: number;
    discador_abandonadas: number;
    abandono: number | null;
    fallas_tecnicas: number | null;
    tmc_segundos: number | null;
    en_curso: number;
  };
  por_hora: { hora: number; gestiones: number; contactos: number; intentos: number }[];
  por_ejecutivo: {
    profile_id: string;
    gestiones: number;
    contactos: number;
    ventas: number;
    tmo_segundos: number | null;
    pausa_segundos: number;
    pausa_por_motivo: { motivo: string; segundos: number }[];
  }[];
  pausa_equipo: { motivo: string; segundos: number }[];
};

/**
 * Tablero del día (hora Chile) sobre los mismos ejecutivos que ve el monitor:
 * TMO, contactabilidad, abandono, producción, curva por hora y pausa por
 * motivo. get_live_wallboard acota por supervisor y empresa.
 */
export async function getLiveWallboard(campaignId?: string | null): Promise<LiveWallboard> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_live_wallboard", { p_campaign_id: campaignId || null });
  if (error) throw new Error(error.message);
  return data as LiveWallboard;
}
