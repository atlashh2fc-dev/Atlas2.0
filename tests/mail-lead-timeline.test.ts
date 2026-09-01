import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timeline = readFileSync(
  new URL("../src/components/lead-timeline.tsx", import.meta.url),
  "utf8",
);
const leadDetail = readFileSync(
  new URL("../src/app/dashboard/leads/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("correo es un canal visible y no una integración genérica", () => {
  assert.match(timeline, /source: "call" \| "email"/);
  assert.match(timeline, /\{ id: "email", label: "Correo" \}/);
  assert.match(timeline, /entry\.source === "email"/);
  assert.match(leadDetail, /event\.event_type === "engagement\.event\.v1" \? "email" : "integration"/);
});

test("la señal mail distingue apertura, click y contexto opcional", () => {
  assert.match(leadDetail, /return "Click en correo"/);
  assert.match(leadDetail, /return "Apertura de correo"/);
  assert.match(leadDetail, /event\.payload\?\.message_subject/);
  assert.match(leadDetail, /event\.payload\?\.link_url/);
  assert.match(leadDetail, /url\.hostname/);
  assert.doesNotMatch(leadDetail, /`Enlace: \$\{event\.payload\?\.link_url\}`/);
});
