import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  integrationV2ContentSha256,
  integrationV2Destinations,
  evaluateIntegrationV2Ack,
  integrationV2OutboundBody,
  integrationV2RetryDelaySeconds,
  integrationV2Signature,
  partitionIntegrationV2Outbound,
  verifyIntegrationV2WorkerAuthorization,
} from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type OutboxItem = {
  outbox_id: string;
  destination_source_code: string;
  event_id: string;
  event_type: string;
  schema_version: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
};

async function nackOutbox(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    workerId: string;
    ids: string[];
    code: string;
    retryable: boolean;
    retryAfter: number;
    httpStatus: number | null;
    detail?: string | null;
  },
) {
  if (!args.ids.length) return;
  const result = await admin.rpc("nack_integration_outbox_v2", {
    p_worker_id: args.workerId,
    p_event_ids: args.ids,
    p_error_code: args.code,
    p_error_detail: args.detail ?? null,
    p_retryable: args.retryable,
    p_retry_after_seconds: args.retryAfter,
    p_http_status: args.httpStatus,
  });
  if (result.error) throw result.error;
}

async function handle(request: NextRequest, requestedLimit: number) {
  if (!verifyIntegrationV2WorkerAuthorization(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const destinations = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON);
  if (!destinations.size) {
    return NextResponse.json({ error: "No hay destinos outbox configurados." }, { status: 503 });
  }
  const limit = Math.min(Math.max(requestedLimit, 1), 250);
  const workerId = `atlas-v2-outbox-${randomUUID()}`;
  const admin = createAdminClient();
  const claimedResult = await admin.rpc("claim_integration_outbox_v2", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 60,
  });
  if (claimedResult.error) {
    return NextResponse.json({ error: "No se pudo reclamar el outbox." }, { status: 500 });
  }

  const groups = new Map<string, OutboxItem[]>();
  for (const item of (claimedResult.data ?? []) as OutboxItem[]) {
    groups.set(item.destination_source_code, [...(groups.get(item.destination_source_code) ?? []), item]);
  }
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const [sourceCode, sourceItems] of groups) {
    const destination = destinations.get(sourceCode);
    const sourceIds = sourceItems.map((item) => item.outbox_id);
    if (!destination) {
      await nackOutbox(admin, {
        workerId, ids: sourceIds, code: "destination_not_configured",
        retryable: true, retryAfter: 300, httpStatus: null,
      });
      retried += sourceIds.length;
      continue;
    }

    const partition = partitionIntegrationV2Outbound(sourceItems);
    if (partition.oversized.length) {
      const oversizedIds = partition.oversized.map((item) => item.outbox_id);
      await nackOutbox(admin, {
        workerId, ids: oversizedIds, code: "payload_too_large",
        retryable: false, retryAfter: 1, httpStatus: null,
      });
      deadLettered += oversizedIds.length;
    }
    for (const items of partition.batches) {
      const ids = items.map((item) => item.outbox_id);
      const rawBody = integrationV2OutboundBody(items);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const idempotencyKey = `atlas2-${integrationV2ContentSha256(Buffer.from(items.map((item) => item.event_id).sort().join("\n"))).slice(0, 48)}`;
      try {
        const response = await fetch(destination.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-atlas-source": "atlas2",
            "x-atlas-timestamp": timestamp,
            "x-atlas-signature": integrationV2Signature(destination.secret, timestamp, rawBody),
            "idempotency-key": idempotencyKey,
          },
          body: rawBody,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 202) {
          const responseBody: unknown = await response.json().catch(() => null);
          const acknowledgment = evaluateIntegrationV2Ack(
            response.status,
            responseBody,
            items.map((item) => item.event_id),
          );
          const confirmedIds = new Set(acknowledgment.confirmed);
          const confirmed = items.filter((item) => confirmedIds.has(item.event_id));
          const missing = items.filter((item) => !confirmedIds.has(item.event_id));
          if (confirmed.length) {
            const ack = await admin.rpc("ack_integration_outbox_v2", {
              p_worker_id: workerId, p_event_ids: confirmed.map((item) => item.outbox_id),
              p_provider_ack: response.headers.get("x-ack-id"), p_http_status: response.status,
            });
            if (ack.error) throw ack.error;
            delivered += confirmed.length;
          }
          if (missing.length) {
            await nackOutbox(admin, {
              workerId, ids: missing.map((item) => item.outbox_id), code: "incomplete_ack",
              retryable: true,
              retryAfter: integrationV2RetryDelaySeconds(
                Math.max(...missing.map((item) => item.attempts)),
                missing.map((item) => item.event_id).join("\n"),
              ),
              httpStatus: response.status,
            });
            retried += missing.length;
          }
        } else {
          const retryable = (response.status >= 300 && response.status < 400)
            || response.status === 408 || response.status === 429 || response.status >= 500;
          await nackOutbox(admin, {
            workerId, ids, code: "destination_http_error", retryable,
            retryAfter: retryable
              ? integrationV2RetryDelaySeconds(
                  Math.max(...items.map((item) => item.attempts)),
                  items.map((item) => item.event_id).join("\n"),
                )
              : 1,
            httpStatus: response.status,
          });
          if (retryable) retried += ids.length;
          else deadLettered += ids.length;
        }
      } catch (error) {
        await nackOutbox(admin, {
          workerId, ids, code: "destination_unreachable", retryable: true,
          retryAfter: integrationV2RetryDelaySeconds(
            Math.max(...items.map((item) => item.attempts)),
            items.map((item) => item.event_id).join("\n"),
          ),
          httpStatus: null, detail: error instanceof Error ? error.message : null,
        });
        retried += ids.length;
      }
    }
  }

  return NextResponse.json({ claimed: (claimedResult.data ?? []).length, delivered, retried, dead_lettered: deadLettered });
}

export async function GET(request: NextRequest) {
  return handle(request, 100);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? body.limit : 100;
  return handle(request, limit);
}
