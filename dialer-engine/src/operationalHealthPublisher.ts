import { logger } from "./logger";
import { supabase } from "./supabaseClient";

type OperationalSnapshot = {
  status: "ready" | "degraded";
  release: string;
  ami: "connected" | "disconnected";
  [key: string]: unknown;
};

/** Publica sólo telemetría sanitizada; el snapshot nunca contiene secretos. */
export async function publishOperationalHealth(snapshot: OperationalSnapshot): Promise<boolean> {
  const { error } = await supabase.from("dialer_operational_health").upsert(
    {
      service: "dialer-engine",
      status: snapshot.status,
      release: snapshot.release,
      ami_status: snapshot.ami,
      payload: snapshot,
      reported_at: new Date().toISOString(),
    },
    { onConflict: "service" }
  );
  if (error) {
    logger.error({ code: error.code }, "No se pudo publicar la salud operacional");
    return false;
  }
  return true;
}
