"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { AgentActivityReportRow, CallMetricsReportRow } from "@/lib/types";
import type { CampaignDirection } from "@/lib/metric-definitions";

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
export type ReportCampaign = {
  id: string;
  name: string;
  /** Dirección declarada; decide qué familia de KPIs corresponde mostrar. */
  direction: CampaignDirection;
};

export async function listCampaignsForReports(): Promise<ReportCampaign[]> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, dialer_campaign_configs(campaign_type)")
    .order("name");
  if (error) throw new Error(error.message);

  return (data ?? []).map((campaign) => {
    // El embed llega como arreglo cuando PostgREST no puede probar que la
    // relación es uno a uno. Una campaña sin configuración de discado todavía
    // no marca: se asume saliente, que es lo que hace el motor.
    const config = campaign.dialer_campaign_configs as
      | { campaign_type: string }
      | { campaign_type: string }[]
      | null;
    const raw = Array.isArray(config) ? config[0]?.campaign_type : config?.campaign_type;
    const direction: CampaignDirection =
      raw === "inbound" || raw === "blending" ? raw : "outbound";
    return { id: campaign.id, name: campaign.name, direction };
  });
}
