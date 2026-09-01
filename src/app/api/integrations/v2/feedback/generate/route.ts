import { NextRequest, NextResponse } from "next/server";

import { ringIntegrationV2Doorbell, verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: NextRequest, sourceCode: string, requestedLimit: number) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (sourceCode !== "bigdata" && sourceCode !== "atlas_lead") {
    return NextResponse.json({ error: "Destino de feedback no soportado." }, { status: 400 });
  }
  const limit = Math.min(Math.max(requestedLimit, 1), 500);
  const admin = createAdminClient();
  const { data, error } = sourceCode === "atlas_lead"
    ? await admin.rpc("generate_atlas_lead_operation_feedback_v2", { p_limit: limit })
    : await admin.rpc("generate_operation_feedback_v2", {
      p_destination_source_code: "bigdata",
      p_limit: limit,
    });
  if (error) {
    console.error("integration_v2_feedback_generation_failed", { sourceCode, message: error.message });
    return NextResponse.json({ error: "No se pudo generar el feedback." }, { status: 500 });
  }
  const doorbell = await ringIntegrationV2Doorbell({
    fallbackOrigin: request.nextUrl.origin,
    path: "/api/integrations/v2/outbox/dispatch",
    secret: process.env.INTEGRATION_WORKER_SECRET ?? process.env.CRON_SECRET,
    limit,
  });
  return NextResponse.json({
    ...(typeof data === "object" && data !== null ? data : {}),
    dispatch_doorbell: doorbell ? "accepted" : "cron_fallback",
  });
}

export async function GET(request: NextRequest) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();
  const [bigdata, atlasLead] = await Promise.all([
    admin.rpc("generate_operation_feedback_v2", {
      p_destination_source_code: "bigdata",
      p_limit: 500,
    }),
    admin.rpc("generate_atlas_lead_operation_feedback_v2", { p_limit: 500 }),
  ]);
  if (bigdata.error || atlasLead.error) {
    console.error("integration_v2_feedback_generation_failed", {
      bigdata: bigdata.error?.message,
      atlasLead: atlasLead.error?.message,
    });
    return NextResponse.json({ error: "No se pudo generar el feedback." }, { status: 500 });
  }
  const doorbell = await ringIntegrationV2Doorbell({
    fallbackOrigin: request.nextUrl.origin,
    path: "/api/integrations/v2/outbox/dispatch",
    secret: process.env.INTEGRATION_WORKER_SECRET ?? process.env.CRON_SECRET,
    limit: 500,
  });
  return NextResponse.json({
    bigdata: bigdata.data,
    atlas_lead: atlasLead.data,
    dispatch_doorbell: doorbell ? "accepted" : "cron_fallback",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sourceCode = typeof body.destination_source_code === "string"
    ? body.destination_source_code.trim().toLowerCase()
    : "bigdata";
  const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : 500;
  return handle(request, sourceCode, limit);
}
