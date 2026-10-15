import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type ClaimedItem = { item_id: string; event_type: string };
const TANDA = 20;
// Deja margen dentro de maxDuration (60 s) para la última tanda.
const PRESUPUESTO_MS = 40_000;
type ProcessResult = { item_id: string; success: boolean; error_code: string | null };
const NON_RETRYABLE_PROJECTION_ERRORS = new Set([
  "invalid_priority_rank",
  "invalid_engagement_semantics",
  "invalid_event_kind",
  "invalid_message_id",
  "invalid_message_direction",
  "invalid_message_subject",
  "invalid_message_body",
]);

async function nack(
  admin: ReturnType<typeof createAdminClient>,
  workerId: string,
  ids: string[],
  code: string,
  retryable: boolean,
  detail?: string,
) {
  if (!ids.length) return;
  const { error } = await admin.rpc("nack_integration_items_v2", {
    p_worker_id: workerId,
    p_item_ids: ids,
    p_error_code: code,
    p_error_detail: detail ?? null,
    p_retryable: retryable,
    p_retry_after_seconds: 30,
  });
  if (error) throw error;
}

async function processGroup(
  admin: ReturnType<typeof createAdminClient>,
  workerId: string,
  ids: string[],
  rpc: "apply_intelligence_decisions_v2" | "apply_engagement_events_v2" | "apply_mail_messages_v1",
) {
  if (!ids.length) return { succeeded: 0, retried: 0, rejected: 0 };
  const { data, error } = await admin.rpc(rpc, { p_worker_id: workerId, p_item_ids: ids });
  if (error) {
    await nack(admin, workerId, ids, "projection_failed", true, error.message);
    return { succeeded: 0, retried: ids.length, rejected: 0 };
  }

  const results = (data ?? []) as ProcessResult[];
  const succeeded = results.filter((result) => result.success).map((result) => result.item_id);
  const invalid = results
    .filter((result) => !result.success && result.error_code !== null
      && NON_RETRYABLE_PROJECTION_ERRORS.has(result.error_code))
    .map((result) => result.item_id);
  const retryable = results
    .filter((result) => !result.success
      && (result.error_code === null || !NON_RETRYABLE_PROJECTION_ERRORS.has(result.error_code)))
    .map((result) => result.item_id);
  const returned = new Set(results.map((result) => result.item_id));
  const missing = ids.filter((id) => !returned.has(id));

  if (succeeded.length) {
    const ackResult = await admin.rpc("ack_integration_items_v2", {
      p_worker_id: workerId,
      p_item_ids: succeeded,
      p_result: { projection: rpc },
    });
    if (ackResult.error) throw ackResult.error;
  }
  await nack(admin, workerId, invalid, "invalid_payload", false);
  await nack(admin, workerId, [...retryable, ...missing], "dependency_not_ready", true);
  return { succeeded: succeeded.length, retried: retryable.length + missing.length, rejected: invalid.length };
}

async function handle(request: NextRequest, requestedLimit: number) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const limit = Math.min(Math.max(requestedLimit, 1), 500);
  const workerId = `atlas-v2-${randomUUID()}`;
  const admin = createAdminClient();
  const inicio = Date.now();
  const totales = { claimed: 0, succeeded: 0, retried: 0, rejected: 0 };

  try {
    // En tandas chicas: cada evento de correo crea o enruta su lead (~0,3 s), y
    // un lote de 100 en una sola RPC superaba el statement timeout. Pasó el
    // 15-10-2026 al reenviar la historia de cuatro campañas (962 eventos): todos
    // los lotes fallaban y la cola no avanzaba.
    while (totales.claimed < limit && Date.now() - inicio < PRESUPUESTO_MS) {
      const { data, error } = await admin.rpc("claim_integration_items_v2", {
        p_worker_id: workerId,
        p_limit: Math.min(TANDA, limit - totales.claimed),
        p_lease_seconds: 60,
      });
      if (error) throw error;
      const claimed = (data ?? []) as ClaimedItem[];
      if (!claimed.length) break;
      const decisions = claimed.filter((item) => item.event_type === "intelligence.decision.v1").map((item) => item.item_id);
      const engagements = claimed.filter((item) => item.event_type === "engagement.event.v1").map((item) => item.item_id);
      const mailMessages = claimed.filter((item) => item.event_type === "mail.message.v1").map((item) => item.item_id);

      for (const resultado of [
        await processGroup(admin, workerId, decisions, "apply_intelligence_decisions_v2"),
        await processGroup(admin, workerId, engagements, "apply_engagement_events_v2"),
        await processGroup(admin, workerId, mailMessages, "apply_mail_messages_v1"),
      ]) {
        totales.succeeded += resultado.succeeded;
        totales.retried += resultado.retried;
        totales.rejected += resultado.rejected;
      }
      totales.claimed += claimed.length;
    }
    return NextResponse.json(totales);
  } catch (error) {
    const message = error instanceof Error ? error.message : "worker_failed";
    console.error("integration_v2_worker_failed", { workerId, message });
    return NextResponse.json({ error: "El worker no pudo completar el lote." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request, 100);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : 100;
  return handle(request, limit);
}
