import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INTEGRATION_V2_MAX_ITEMS,
  IntegrationV2ValidationError,
  integrationV2ContentSha256,
  integrationV2Destinations,
  integrationV2Signature,
  integrationV2SourceSecret,
  normalizeIntegrationV2Request,
  parseIntegrationV2Batch,
  partitionIntegrationV2Outbound,
  verifyIntegrationV2Bearer,
  verifyIntegrationV2WorkerAuthorization,
  verifyIntegrationV2Signature,
} from "../src/lib/integration-v2.ts";

const campaignId = "123e4567-e89b-42d3-a456-426614174000";

function decision(index = 1) {
  return {
    event_id: `decision-${index}`,
    event_type: "intelligence.decision.v1",
    external_key: `lead-${index}`,
    occurred_at: "2026-08-25T19:00:00Z",
    payload: { priority_rank: 10, priority_reason: "Alta propensión" },
  };
}

test("valida el contrato acotado de decisiones", () => {
  const parsed = parseIntegrationV2Batch({ campaign_id: campaignId, items: [decision()] });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.campaign_id, campaignId);
  assert.equal(parsed.items[0].occurred_at, "2026-08-25T19:00:00.000Z");
  assert.equal(parsed.schema_version, "1");
});

test("dispatcher parte requests en máximo 250 items y 1 MiB", () => {
  const items = Array.from({ length: 251 }, (_, index) => ({
    event_id: `feedback-${index}`,
    event_type: "operation.feedback.v1",
    created_at: "2026-08-25T20:00:00Z",
    payload: { external_key: `lead-${index}` },
  }));
  const partition = partitionIntegrationV2Outbound(items);
  assert.deepEqual(partition.batches.map((batch) => batch.length), [250, 1]);
  assert.equal(partition.oversized.length, 0);

  const oversized = partitionIntegrationV2Outbound([{ ...items[0], payload: { data: "x".repeat(1024 * 1024) } }]);
  assert.equal(oversized.batches.length, 0);
  assert.equal(oversized.oversized.length, 1);
});

test("middleware publica solo el prefijo v2 protegido por HMAC o Bearer", () => {
  const middleware = readFileSync("src/lib/supabase/middleware.ts", "utf8");
  assert.match(middleware, /"\/api\/integrations\/v2\/"/);
  assert.doesNotMatch(middleware, /"\/api\/integrations"[,\]]/);
});

test("migración protege replay de engagement y replay cross-batch", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825193250_integration_v2_durable_inbox_outbox.sql",
    "utf8",
  );
  assert.match(migration, /projected_item_id is null/);
  assert.match(migration, /projected_item_id is not null or/);
  assert.match(migration, /on conflict \(source_id, event_id\) do nothing/);
  assert.match(migration, /rows_replayed/);
  assert.match(migration, /rut_match_count = 1/);
  assert.match(migration, /rut_match_ambiguous/);
});

test("dispatcher no sigue redirects y reintenta respuestas 3xx", () => {
  const route = readFileSync("src/app/api/integrations/v2/outbox/dispatch/route.ts", "utf8");
  assert.match(route, /redirect: "manual"/);
  assert.match(route, /response\.status >= 300 && response\.status < 400/);
});

test("solo habilita destinos outbox HTTPS con secreto fuerte", () => {
  const destinations = integrationV2Destinations(JSON.stringify({
    bigdata: { url: "https://bigdata.example/v2/batches", secret: "z".repeat(32) },
    unsafe: { url: "http://external.example/v2/batches", secret: "z".repeat(32) },
  }));
  assert.equal(destinations.get("bigdata")?.url, "https://bigdata.example/v2/batches");
  assert.equal(destinations.has("unsafe"), false);
});

test("acepta campaign_key externo sin UUID interno", () => {
  const parsed = parseIntegrationV2Batch({ campaign_key: "equifax-2026-08", items: [decision()] });
  assert.equal(parsed.campaign_id, null);
  assert.equal(parsed.campaign_key, "equifax-2026-08");
});

test("rechaza más de 500 items y event_id repetidos", () => {
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_id: campaignId, items: Array.from({ length: INTEGRATION_V2_MAX_ITEMS + 1 }, (_, i) => decision(i)) }),
    IntegrationV2ValidationError,
  );
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_id: campaignId, items: [decision(), decision()] }),
    /event_id duplicado/,
  );
});

test("exige prioridad válida y campaña mail en cada tipo", () => {
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_id: campaignId, items: [{ ...decision(), payload: { priority_rank: 1000 } }] }),
    /priority_rank/,
  );
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_id: campaignId, items: [{ ...decision(), event_type: "engagement.event.v1", payload: { clicked: true } }] }),
    /external_campaign_key/,
  );
});

test("firma exactamente timestamp punto bytes y rechaza replay vencido", () => {
  const secret = "a".repeat(32);
  const timestamp = "1787684400";
  const rawBody = Buffer.from('{"items":[]}');
  const signature = integrationV2Signature(secret, timestamp, rawBody);
  assert.equal(
    verifyIntegrationV2Signature({ secret, timestamp, signature: `sha256=${signature}`, rawBody, nowSeconds: Number(timestamp) + 20 }),
    true,
  );
  assert.equal(
    verifyIntegrationV2Signature({ secret, timestamp, signature, rawBody, nowSeconds: Number(timestamp) + 301 }),
    false,
  );
  assert.equal(integrationV2ContentSha256(rawBody).length, 64);
});

test("separa secretos HMAC por fuente y compara bearer", () => {
  const bigdata = "b".repeat(32);
  const worker = "w".repeat(32);
  assert.equal(integrationV2SourceSecret("BIGDATA", JSON.stringify({ bigdata })), bigdata);
  assert.equal(integrationV2SourceSecret("atlas_lead", JSON.stringify({ bigdata })), null);
  assert.equal(verifyIntegrationV2Bearer(worker, `Bearer ${worker}`), true);
  assert.equal(verifyIntegrationV2Bearer(worker, `Bearer ${worker}x`), false);
  const cron = "c".repeat(32);
  assert.equal(verifyIntegrationV2WorkerAuthorization(`Bearer ${cron}`, worker, cron), true);
  assert.equal(verifyIntegrationV2WorkerAuthorization("Bearer invalid", worker, cron), false);
});

test("normaliza el sobre y aliases reales de Atlas Lead", () => {
  const normalized = normalizeIntegrationV2Request(
    {
      campaign_id: campaignId,
      external_campaign_key: "mail-eq-2026",
      report_date: "2026-08-25",
      rows: [{ correo: "persona@example.com", enviado: "si", abierto: "1", click: true }],
    },
    "atlas_lead",
    "report-2026-08-25-am",
  );
  const parsed = parseIntegrationV2Batch(normalized);
  assert.equal(parsed.items[0].event_id, "report-2026-08-25-am:1");
  assert.equal(parsed.items[0].external_key, "persona@example.com");
  assert.deepEqual(parsed.items[0].payload, {
    external_campaign_key: "mail-eq-2026",
    email: "persona@example.com",
    sent: true,
    delivered: false,
    bounced: false,
    opened: true,
    clicked: true,
    complained: false,
    unsubscribed: false,
  });
});
