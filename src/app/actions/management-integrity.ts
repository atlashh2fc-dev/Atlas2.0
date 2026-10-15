"use server";

import { errorDeAccion } from "@/lib/errores-de-accion";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Detección de tipificaciones automatizadas.
 *
 * Solo consume señales producidas por el servidor —duración de la gestión,
 * eventos de conexión del motor de discado, cadencia entre cierres—. Cualquier
 * dato que viniera del navegador sería falsificable por la misma extensión que
 * se busca detectar, así que no se usa ninguno.
 */

export type IntegrityAgentRow = {
  agent_id: string;
  full_name: string;
  gestiones: number;
  /** Contacto sin conexión, contacto cerrado en segundos o cierre en ráfaga. */
  para_revisar: number;
  contacto_sin_conexion: number;
  cierres_rapidos: number;
  rafagas: number;
  /** «Volver a llamar» sin hablar con el cliente: tema de proceso, no de integridad. */
  reagendados_sin_contacto: number;
  mediana_segundos: number | null;
};

/** Por qué un caso quedó para revisar; si hay varias señales, la más fuerte. */
export type IntegrityMotive = "contacto_sin_conexion" | "cierre_rapido" | "rafaga";

export type IntegrityDetailRow = {
  call_id: string;
  agent_id: string;
  full_name: string;
  lead_id: string;
  lead_name: string;
  status: string | null;
  reason: string | null;
  ended_at: string;
  handle_seconds: number | null;
  seconds_since_previous: number | null;
  motivo: IntegrityMotive;
  /** Último estado que registró la central para esa gestión; null = no hubo llamada desde Atlas. */
  ultimo_intento: string | null;
};

export type ManagementIntegrityReport = {
  range: { from: string; to: string };
  thresholds: { fast_close_seconds: number; burst_seconds: number };
  totals: {
    gestiones: number;
    para_revisar: number;
    contacto_sin_conexion: number;
    cierres_rapidos: number;
    rafagas: number;
    reagendados_sin_contacto: number;
  };
  agents: IntegrityAgentRow[];
  detail: IntegrityDetailRow[];
};

export async function getManagementIntegrityReport(input: {
  from: string;
  to: string;
  campaignId?: string | null;
  /** Acota la lista de casos a un ejecutivo; los totales siguen siendo del equipo. */
  agentId?: string | null;
  fastCloseSeconds?: number;
  burstSeconds?: number;
}): Promise<ManagementIntegrityReport> {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_management_integrity_report", {
    p_from: input.from,
    p_to: input.to,
    p_campaign_id: input.campaignId ?? null,
    p_fast_close_seconds: input.fastCloseSeconds ?? 10,
    p_burst_seconds: input.burstSeconds ?? 5,
    p_agent_id: input.agentId ?? null,
  });

  if (error) throw errorDeAccion(error);
  return data as ManagementIntegrityReport;
}
