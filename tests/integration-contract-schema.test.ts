import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalIntegrationContract,
  INTEGRATION_CONTRACT_VERSION,
  integrationContractSha256,
  stableContractJson,
} from "../src/lib/integration-contract-schema.ts";

test("publica el contrato v2 canónico con digest estable", () => {
  const fromDisk = JSON.parse(readFileSync("contracts/integration-event-v2.schema.json", "utf8"));
  assert.equal(fromDisk["x-contract-version"], INTEGRATION_CONTRACT_VERSION);
  assert.deepEqual(canonicalIntegrationContract(), fromDisk);
  assert.match(integrationContractSha256(), /^[a-f0-9]{64}$/);
  assert.equal(stableContractJson({ b: 2, a: 1 }), stableContractJson({ a: 1, b: 2 }));
});

test("el contrato exige identidad, orden e idempotencia v2", () => {
  const schema = canonicalIntegrationContract();
  const required = schema.$defs.event.required;
  for (const field of [
    "event_id", "event_source", "subject", "entity_version",
    "correlation_id", "causation_id", "payload",
  ]) {
    assert.ok(required.includes(field), `${field} debe ser obligatorio`);
  }
  assert.equal(schema.properties.schema_version.const, "2");
  assert.equal(schema.properties.items.maxItems, 500);
});

test("engagement 2.1 mantiene v1 y declara detalle opcional de delivery/roster", () => {
  const schema = canonicalIntegrationContract();
  assert.equal(INTEGRATION_CONTRACT_VERSION, "2.1.0");
  const engagement = schema.$defs.engagementPayload;
  assert.ok(schema.$defs.event.properties.event_type.enum.includes("operation.feedback.v1"));
  assert.deepEqual(engagement.required, ["external_campaign_key"]);
  for (const field of [
    "event_kind", "event_semantics", "delivery_id", "message_id",
    "message_subject", "link_url", "provider_event_id", "company_name",
    "contact_name", "phone", "country", "source_lead_id",
  ]) {
    assert.ok(field in engagement.properties, `${field} debe estar en engagementPayload`);
  }
});
