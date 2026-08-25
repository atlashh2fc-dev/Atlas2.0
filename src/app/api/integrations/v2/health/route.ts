import { NextRequest, NextResponse } from "next/server";

import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  if (!verifyIntegrationV2WorkerAuthorization(
    request.headers.get("authorization"),
    process.env.INTEGRATION_WORKER_SECRET,
    process.env.CRON_SECRET,
  )) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("integration_v2_health_snapshot");
  if (error) {
    console.error("integration_v2_health_failed", { message: error.message });
    return NextResponse.json({ error: "No se pudo obtener la salud de integración." }, { status: 500 });
  }
  return NextResponse.json({
    ...(typeof data === "object" && data !== null ? data : {}),
    deploy_version: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    node_version: process.version,
    transport: { schema_version: "2", cron_fallback: { inbox_minutes: 2, outbox_minutes: 5 } },
  });
}
