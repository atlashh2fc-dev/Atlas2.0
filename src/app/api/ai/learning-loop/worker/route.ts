import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { extractConversationFacts, processLearningLoop } from "@/lib/ai-learning-loop-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.AI_LOOP_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (process.env.AI_LOOP_ENABLED !== "true") return NextResponse.json({ status: "disabled" });
  const apiKey = process.env.INCEPTION_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "Falta configurar el proveedor de análisis." }, { status: 503 });
  try {
    const admin = createAdminClient();
    const catchup = await admin.rpc("reconcile_ai_loop_runs");
    if (catchup.error) throw new Error("reconcile_failed");
    const result = await processLearningLoop(admin, (source) => extractConversationFacts(source, apiKey));
    return NextResponse.json({ enqueued: catchup.data, ...result });
  } catch {
    // No source text or provider details in logs/HTTP responses.
    console.error("ai_learning_loop_worker_failed");
    return NextResponse.json({ error: "El loop no pudo completar el ciclo." }, { status: 500 });
  }
}

export const POST = GET;
