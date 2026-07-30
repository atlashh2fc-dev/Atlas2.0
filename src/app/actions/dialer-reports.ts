"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { AgentActivityReportRow, CallMetricsReportRow } from "@/lib/types";

/**
 * Reporte histórico de métricas de llamadas (volumen por resultado, ring
 * time, AHT, tasa de abandono, nivel de servicio), agrupado por día y
 * campaña. get_call_metrics_report ya valida admin/supervisor internamente
 * (SECURITY DEFINER), repetimos el check acá para no depender solo de eso.
 */
export async function getCallMetricsReport(
  dateFrom: string,
  dateTo: string,
  campaignId?: string | null
): Promise<CallMetricsReportRow[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_call_metrics_report", {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_campaign_id: campaignId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CallMetricsReportRow[];
}

/**
 * Reporte histórico de actividad por ejecutivo (AHT, ocupación, adherencia),
 * combinando segmentos cerrados de historial con el segmento en curso.
 *
 * Con `campaignId` se filtran solo las métricas de llamada: el tiempo conectado
 * y las pausas son de la jornada completa, así que la función devuelve nulo en
 * esas columnas en vez de un número que no cuadra con el filtro en pantalla.
 */
export async function getAgentActivityReport(
  dateFrom: string,
  dateTo: string,
  campaignId?: string | null
): Promise<AgentActivityReportRow[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_agent_activity_report", {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_campaign_id: campaignId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentActivityReportRow[];
}

/** Lista simple de campañas para el filtro del reporte de métricas de llamadas. */
export async function listCampaignsForReports(): Promise<{ id: string; name: string }[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("campaigns").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}
