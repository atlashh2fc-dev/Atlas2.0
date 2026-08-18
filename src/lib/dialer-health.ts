import { createAdminClient } from "./supabase/admin";
import { interpretDialerHeartbeat, type ServiceProbe } from "./dialer-health-state";

export type { ServiceProbe } from "./dialer-health-state";

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
