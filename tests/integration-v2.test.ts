import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INTEGRATION_V2_MAX_ITEMS,
  IntegrationV2ValidationError,
  integrationV2ContentSha256,
  integrationV2Destinations,
  evaluateIntegrationV2Ack,
  integrationV2OutboundBody,
  integrationV2RetryDelaySeconds,
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
  assert.equal(parsed.items[0].event_source, "urn:geimser:bigdata");
  assert.equal(parsed.items[0].tenant_id, "geimser");
  assert.equal(parsed.items[0].correlation_id, "decision-1");
  assert.equal(parsed.items[0].entity_version, Date.parse("2026-08-25T19:00:00Z"));
});

test("schema 2 exige metadata canónica y conserva correlación", () => {
  const parsed = parseIntegrationV2Batch({
    campaign_key: "equifax-2026-08",
    schema_version: "2",
    items: [{
      ...decision(),
      event_source: "urn:geimser:bigdata",
      subject: "urn:geimser:lead:lead-1",
      data_schema: "urn:geimser:schema:intelligence.decision.v1",
      tenant_id: "geimser",
      entity_version: 7,
      correlation_id: "journey-1",
      causation_id: "decision-source-1",
    }],
  }, "bigdata");
  assert.equal(parsed.schema_version, "2");
  assert.equal(parsed.items[0].subject, "urn:geimser:lead:lead-1");
  assert.equal(parsed.items[0].entity_version, 7);
  assert.equal(parsed.items[0].causation_id, "decision-source-1");
});

test("schema 2 rechaza versión inválida, fuente cruzada y metadata ausente", () => {
  const canonical = {
    ...decision(), event_source: "urn:geimser:bigdata", subject: "lead:1",
    data_schema: "urn:schema:decision", tenant_id: "geimser", entity_version: 1,
    correlation_id: "correlation-1", causation_id: null,
  };
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "c", schema_version: "2", items: [{ ...canonical, entity_version: "one" }] }, "bigdata"),
    /entity_version/,
  );
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "c", schema_version: "2", items: [{ ...canonical, event_source: "urn:geimser:atlas-lead" }] }, "bigdata"),
    /no coincide/,
  );
  const { subject: _subject, ...withoutSubject } = canonical;
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "c", schema_version: "2", items: [withoutSubject] }, "bigdata"),
    /subject/,
  );
});

test("canary E2E no requiere campaña y no admite mezcla de negocio", () => {
  const canary = {
    event_id: "canary-atlas-lead-1",
    event_type: "integration.canary.v1",
    event_source: "urn:geimser:atlas-lead",
    subject: "urn:geimser:canary:atlas-lead",
    external_key: "canary-atlas-lead",
    occurred_at: "2026-08-25T20:00:00Z",
    data_schema: "urn:geimser:schema:integration.canary.v1",
    tenant_id: "geimser",
    entity_version: 1,
    correlation_id: "canary-correlation-1",
    causation_id: null,
    payload: { synthetic: true, action: "none" },
  };
  const parsed = parseIntegrationV2Batch({ schema_version: "2", items: [canary] }, "atlas_lead");
  assert.equal(parsed.campaign_id, null);
  assert.equal(parsed.campaign_key, null);
  assert.equal(parsed.items[0].event_type, "integration.canary.v1");
  assert.throws(
    () => parseIntegrationV2Batch({ schema_version: "2", items: [canary, decision(2)] }, "atlas_lead"),
    /campaign_key es obligatorio/,
  );
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

test("outbox emite schema 2 canónico sin UUID interno", () => {
  const body = JSON.parse(integrationV2OutboundBody([{
    event_id: "feedback-1",
    event_type: "operation.feedback.v1",
    created_at: "2026-08-25T20:00:00Z",
    payload: { external_key: "lead-external-1", correlation_id: "call-1" },
  }]).toString("utf8"));
  assert.equal(body.schema_version, "2");
  assert.equal(body.items[0].event_source, "urn:geimser:atlas2");
  assert.equal(body.items[0].external_key, "lead-external-1");
  assert.equal(body.items[0].correlation_id, "call-1");
  assert.equal("campaign_id" in body, false);
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

test("migración v2 serializa entidad, ACK stale e idempotencia source+event", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825215021_integration_v2_contract_ordering_health.sql",
    "utf8",
  );
  assert.match(migration, /unique index if not exists integration_inbox_items_source_event_uidx/);
  assert.match(migration, /primary key \(tenant_id, subject\)/);
  assert.match(migration, /stale_entity_version/);
  assert.match(migration, /set status = 'succeeded'[\s\S]*processed_at = now\(\)/);
  assert.match(migration, /earlier\.entity_version < i\.entity_version/);
  assert.match(migration, /public\.integration_entity_versions/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /integration\.canary\.v1/);
  assert.match(migration, /case when v_is_canary then 'succeeded'/);
  assert.match(migration, /'action', 'none'/);
});

test("migración no realiza HTTP y deja circuit breaker antes del claim", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825215021_integration_v2_contract_ordering_health.sql",
    "utf8",
  );
  assert.doesNotMatch(migration, /net\.http|http_post|pg_net/i);
  assert.match(migration, /integration_circuit_states/);
  assert.match(migration, /consecutive_failures \+ 1 >= 5/);
  assert.match(migration, /circuit\.opened_until is null or circuit\.opened_until <= now\(\)/);
});

test("dispatcher no sigue redirects y reintenta respuestas 3xx", () => {
  const route = readFileSync("src/app/api/integrations/v2/outbox/dispatch/route.ts", "utf8");
  assert.match(route, /redirect: "manual"/);
  assert.match(route, /response\.status >= 300 && response\.status < 400/);
});

test("ACK parcial confirma sólo IDs exactos y HTML jamás confirma", () => {
  assert.deepEqual(
    evaluateIntegrationV2Ack(202, { acknowledged: true, accepted_event_ids: ["a"] }, ["a", "b"]),
    { confirmed: ["a"], missing: ["b"] },
  );
  assert.deepEqual(
    evaluateIntegrationV2Ack(200, "<html>ok</html>", ["a"]),
    { confirmed: [], missing: ["a"] },
  );
  assert.deepEqual(
    evaluateIntegrationV2Ack(302, { acknowledged: true, accepted_event_ids: ["a"] }, ["a"]),
    { confirmed: [], missing: ["a"] },
  );
});

test("backoff con jitter queda acotado durante retry storm", () => {
  const delays = Array.from({ length: 20 }, (_, index) => integrationV2RetryDelaySeconds(index + 1, `event-${index}`));
  assert.ok(delays.every((delay) => delay >= 5 && delay <= 1080));
  assert.ok(delays[10] >= delays[0]);
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
  const parsed = parseIntegrationV2Batch(normalized, "atlas_lead");
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
    event_semantics: "cumulative_snapshot",
  });
  assert.equal(parsed.items[0].event_source, "urn:geimser:atlas-lead");
});

test("engagement atómico conserva identidad de entrega, enlace y roster", () => {
  const parsed = parseIntegrationV2Batch({
    campaign_key: "mail-eq-2026",
    items: [{
      event_id: "open-1",
      event_type: "engagement.event.v1",
      external_key: "atlas-lead-contact-1",
      occurred_at: "2026-09-01T12:00:00Z",
      payload: {
        external_campaign_key: "mail-eq-2026",
        event_kind: "clicked",
        event_semantics: "atomic_event",
        delivery_id: "delivery-1",
        message_id: "message-1",
        message_subject: "Propuesta Atlas",
        provider_event_id: "provider-event-1",
        link_url: "https://example.com/demo",
        email: "persona@example.com",
        company_name: "Empresa Uno",
        contact_name: "Persona Uno",
        phone: "+56911111111",
        country: "CL",
        source_lead_id: "atlas-lead-contact-1",
      },
    }],
  }, "atlas_lead");

  assert.deepEqual(parsed.items[0].payload, {
    external_campaign_key: "mail-eq-2026",
    event_kind: "clicked",
    event_semantics: "atomic_event",
    delivery_id: "delivery-1",
    message_id: "message-1",
    message_subject: "Propuesta Atlas",
    provider_event_id: "provider-event-1",
    link_url: "https://example.com/demo",
    email: "persona@example.com",
    company_name: "Empresa Uno",
    contact_name: "Persona Uno",
    phone: "+56911111111",
    country: "CL",
    source_lead_id: "atlas-lead-contact-1",
  });
});

test("engagement rechaza semántica, tipo y enlace inválidos", () => {
  const base = {
    ...decision(),
    event_type: "engagement.event.v1",
    payload: { external_campaign_key: "mail-eq-2026" },
  };
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "mail-eq-2026", items: [{ ...base, payload: { ...base.payload, event_semantics: "delta" } }] }, "atlas_lead"),
    /event_semantics/,
  );
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "mail-eq-2026", items: [{ ...base, payload: { ...base.payload, event_kind: "visited" } }] }, "atlas_lead"),
    /event_kind/,
  );
  assert.throws(
    () => parseIntegrationV2Batch({ campaign_key: "mail-eq-2026", items: [{ ...base, payload: { ...base.payload, link_url: "ftp://example.com/file" } }] }, "atlas_lead"),
    /HTTP o HTTPS/,
  );
});

test("mail.message proyecta el cuerpo completo sólo con identidad de hilo válida", () => {
  const message = {
    event_id: "mail.message.v1:message-1",
    event_type: "mail.message.v1",
    event_source: "urn:geimser:atlas-lead",
    subject: "urn:geimser:atlas-lead:mail-message:message-1",
    external_key: "123e4567-e89b-42d3-a456-426614174111",
    occurred_at: "2026-09-04T12:00:00Z",
    data_schema: "urn:geimser:schema:mail.message.v1:1",
    tenant_id: "geimser",
    entity_version: 1,
    correlation_id: "message-1",
    causation_id: null,
    payload: {
      external_campaign_key: "123e4567-e89b-42d3-a456-426614174222",
      source_lead_id: "123e4567-e89b-42d3-a456-426614174111",
      message_id: "message-1",
      direction: "outbound",
      from_email: "contacto@send.geimser.cl",
      to_email: "cliente@example.com",
      message_subject: "Propuesta comercial",
      message_body: "Contenido visible para el ejecutivo asignado.",
    },
  };
  const parsed = parseIntegrationV2Batch({
    campaign_key: message.payload.external_campaign_key,
    schema_version: "2",
    items: [message],
  }, "atlas_lead");
  assert.equal(parsed.items[0].payload.message_body, message.payload.message_body);
  assert.throws(
    () => parseIntegrationV2Batch({
      campaign_key: message.payload.external_campaign_key,
      schema_version: "2",
      items: [{ ...message, payload: { ...message.payload, message_body: "" } }],
    }, "atlas_lead"),
    /message_body/,
  );
});

test("carga canónica queda acotada a 500 eventos", () => {
  const items = Array.from({ length: 500 }, (_, index) => decision(index + 1));
  const parsed = parseIntegrationV2Batch({ campaign_key: "bounded-load", items }, "bigdata");
  assert.equal(parsed.items.length, 500);
  assert.equal(new Set(parsed.items.map((item) => `${item.event_source}:${item.event_id}`)).size, 500);
});

test("canary prueba contrato y persiste snapshot sin proyectar negocio", () => {
  const route = readFileSync("src/app/api/integrations/v2/canary/route.ts", "utf8");
  assert.match(route, /parseIntegrationV2Batch/);
  assert.match(route, /record_integration_canary_v2/);
  assert.doesNotMatch(route, /accept_integration_batch_v2/);
});

test("salud Customer 360 distingue actividad histórica de atraso operativo", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825224500_fix_customer360_health_semantics.sql",
    "utf8",
  );
  assert.match(migration, /'observed_last_24h'/);
  assert.match(migration, /'historical_over_24h'/);
  assert.doesNotMatch(migration, /'stale_over_24h'/);
});
