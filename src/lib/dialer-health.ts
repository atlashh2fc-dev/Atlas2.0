import { createAdminClient } from "./supabase/admin";
import { interpretDialerHeartbeat, type ServiceProbe } from "./dialer-health-state";

export type { ServiceProbe } from "./dialer-health-state";

export type AgentSipSyncHealth = {
  status: "ok" | "failed" | "stale" | "starting" | "unknown";
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  reportedAt: string | null;
};

type StoredCheck = {
  status?: unknown;
  consecutive_failures?: unknown;
  last_success_at?: unknown;
};

/**
 * La credencial en Supabase no demuestra que Asterisk haya cargado el
 * endpoint. Esta lectura interna permite que Administración muestre ambas
 * verdades por separado sin exponer la tabla de telemetría al navegador.
 */
export async function getAgentSipSyncHealth(): Promise<AgentSipSyncHealth> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("dialer_operational_health")
      .select("payload, reported_at")
      .eq("service", "dialer-engine")
      .maybeSingle();
    if (error || !data) {
      return { status: "unknown", consecutiveFailures: 0, lastSuccessAt: null, reportedAt: null };
    }

    const payload = data.payload as { checks?: { agentConfigSync?: StoredCheck } } | null;
    const check = payload?.checks?.agentConfigSync;
    const allowed = new Set(["ok", "failed", "stale", "starting"]);
    const status = typeof check?.status === "string" && allowed.has(check.status)
      ? check.status as AgentSipSyncHealth["status"]
      : "unknown";

    return {
      status,
      consecutiveFailures: Number.isFinite(Number(check?.consecutive_failures))
        ? Math.max(0, Number(check?.consecutive_failures))
        : 0,
      lastSuccessAt: typeof check?.last_success_at === "string" ? check.last_success_at : null,
      reportedAt: typeof data.reported_at === "string" ? data.reported_at : null,
    };
  } catch {
    return { status: "unknown", consecutiveFailures: 0, lastSuccessAt: null, reportedAt: null };
  }
}

export async function probeDialerHeartbeat(): Promise<ServiceProbe> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("dialer_operational_health")
      .select("status, reported_at")
      .eq("service", "dialer-engine")
      .maybeSingle();
    if (error) return "unknown";
    return interpretDialerHeartbeat(data);
  } catch {
    return "unknown";
  }
}
