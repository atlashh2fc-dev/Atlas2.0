import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  integrationV2Signature,
  parseIntegrationV2Batch,
  verifyIntegrationV2Signature,
  verifyIntegrationV2WorkerAuthorization,
} from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

type QueueHealth = { oldest_queue_age_seconds?: number | null; dead_letter?: number };
type HealthSnapshot = {
  inbox?: QueueHealth;
  outbox?: QueueHealth;
  dlq?: { last_24h?: number };
  circuits?: Array<{ state?: string }>;
};

export async function GET(request: NextRequest) {
  if (!verifyIntegrationV2WorkerAuthorization(
    request.headers.get("authorization"),
    process.env.INTEGRATION_WORKER_SECRET,
    process.env.CRON_SECRET,
  )) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const startedAt = Date.now();
  const eventId = `canary-${randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const synthetic = parseIntegrationV2Batch({
    schema_version: "2",
    items: [{
      event_id: eventId,
      event_type: "integration.canary.v1",
      event_source: "urn:geimser:atlas2",
      subject: "urn:geimser:canary:integration-v2",
      occurred_at: occurredAt,
      data_schema: "urn:geimser:schema:integration.canary.v1",
      tenant_id: "geimser",
      entity_version: Date.now(),
      correlation_id: eventId,
      causation_id: null,
      external_key: "synthetic-canary",
      payload: { synthetic: true, action: "none" },
    }],
  }, "atlas2");
  const raw = Buffer.from(JSON.stringify(synthetic));
  const secret = "synthetic-only-not-a-transport-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const contractValid = verifyIntegrationV2Signature({
    secret,
    timestamp,
    rawBody: raw,
    signature: integrationV2Signature(secret, timestamp, raw),
  });

  const admin = createAdminClient();
  const healthResult = await admin.rpc("integration_v2_health_snapshot");
  if (healthResult.error) {
    return NextResponse.json({ error: "Canary sin snapshot de salud." }, { status: 500 });
  }
  const health = (healthResult.data ?? {}) as HealthSnapshot;
  const degradedReasons = [
    (health.inbox?.oldest_queue_age_seconds ?? 0) > 300 ? "inbox_age" : null,
    (health.outbox?.oldest_queue_age_seconds ?? 0) > 600 ? "outbox_age" : null,
    (health.dlq?.last_24h ?? 0) > 0 ? "dlq_24h" : null,
    health.circuits?.some((circuit) => circuit.state === "open") ? "circuit_open" : null,
    !contractValid ? "contract" : null,
  ].filter((reason): reason is string => Boolean(reason));
  const status = degradedReasons.length ? "degraded" : "healthy";
  const latencyMs = Date.now() - startedAt;
  const canaryKey = `integration-v2-${new Date().toISOString().slice(0, 13)}`;
  const recorded = await admin.rpc("record_integration_canary_v2", {
    p_canary_key: canaryKey,
    p_status: status,
    p_latency_ms: latencyMs,
    p_details: { contract_valid: contractValid, degraded_reasons: degradedReasons },
  });
  if (recorded.error) {
    return NextResponse.json({ error: "Canary no pudo persistir resultado." }, { status: 500 });
  }
  return NextResponse.json({ status, latency_ms: latencyMs, degraded_reasons: degradedReasons });
}
