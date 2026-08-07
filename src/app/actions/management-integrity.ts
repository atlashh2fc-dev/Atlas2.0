"use server";

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
  sospechosas: number;
  cierres_instantaneos: number;
  contactos_sin_respaldo: number;
  rafagas: number;
  mediana_segundos: number | null;
  minimo_segundos: number | null;
};

export type IntegrityDetailRow = {
  call_id: string;
  agent_id: string;
  full_name: string;
  lead_id: string;
  lead_name: string;
  status: string | null;
  reason: string | null;
  started_at: string;
  ended_at: string;
  handle_seconds: number | null;
  seconds_since_previous: number | null;
  tuvo_conexion: boolean;
  cierre_instantaneo: boolean;
  contacto_sin_respaldo: boolean;
  rafaga: boolean;
};

export type ManagementIntegrityReport = {
  range: { from: string; to: string };
  thresholds: { fast_close_seconds: number; burst_seconds: number };
  totals: {
    gestiones: number;
    sospechosas: number;
    cierres_instantaneos: number;
    contactos_sin_respaldo: number;
    rafagas: number;
  };
  agents: IntegrityAgentRow[];
  detail: IntegrityDetailRow[];
};

export async function getManagementIntegrityReport(input: {
  from: string;
  to: string;
  campaignId?: string | null;
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
  });

  if (error) throw new Error(error.message);
  return data as ManagementIntegrityReport;
}
