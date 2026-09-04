import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260904181500_mail_customer_and_agent_reply_filters.sql", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../src/app/dashboard/mail/page.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("../src/components/mail-control-center.tsx", import.meta.url), "utf8");

test("la cola prioriza respuestas nuevas del cliente y separa las atendidas por agente", () => {
  assert.match(migration, /'customer_replied'.*'Respuesta cliente pendiente'/s);
  assert.match(migration, /'agent_replied'.*'Respondido por agente'/s);
  assert.match(migration, /last_inbound_at > cl\.last_agent_reply_at/);
  assert.match(migration, /can_supervise_mail_lead/);
});

test("la interfaz ofrece ambos filtros y estados visibles", () => {
  assert.match(page, /"customer_replied"/);
  assert.match(page, /"agent_replied"/);
  assert.match(control, /Respuesta cliente/);
  assert.match(control, /Respondido/);
});
