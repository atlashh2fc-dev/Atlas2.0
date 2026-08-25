import { NextRequest, NextResponse } from "next/server";

import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: NextRequest, sourceCode: string, requestedLimit: number) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("generate_operation_feedback_v2", {
    p_destination_source_code: sourceCode,
    p_limit: Math.min(Math.max(requestedLimit, 1), 500),
  });
  if (error) {
    console.error("integration_v2_feedback_generation_failed", { sourceCode, message: error.message });
    return NextResponse.json({ error: "No se pudo generar el feedback." }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function GET(request: NextRequest) {
  return handle(request, "bigdata", 500);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sourceCode = typeof body.destination_source_code === "string" ? body.destination_source_code : "bigdata";
  const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : 500;
  return handle(request, sourceCode, limit);
}
