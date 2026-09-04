import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/dashboard/admin/agentes-sip/page.tsx", "utf8");
const health = readFileSync("src/lib/dialer-health.ts", "utf8");

test("Diagnóstico SIP separa la configuración automática del estado real de Asterisk", () => {
  assert.match(page, /getAgentSipSyncHealth/);
  assert.match(page, /Evita activar, desactivar o/);
  assert.match(page, /Acciones de contingencia/);
  assert.doesNotMatch(page, /provisionAgentExtension/);
  assert.match(page, /Operativa en Asterisk/);
  assert.match(page, /Error de aprovisionamiento/);
  assert.match(page, /Pendiente de Asterisk/);
  assert.doesNotMatch(page, /\{row\.is_active \? "Activa" : "Inactiva"\}/);

  assert.match(health, /agentConfigSync/);
  assert.match(health, /createAdminClient/);
  assert.match(health, /status: "unknown"/);
});

test("el estado operativo se conserva por agente y no sólo a nivel global", () => {
  const actions = readFileSync("src/app/actions/agent-sip.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260904144000_agent_sip_provisioning_state.sql",
    "utf8",
  );

  assert.match(actions, /agent_sip_provisioning_status/);
  assert.match(actions, /provisioning_failure_code/);
  assert.match(migration, /mark_agent_sip_provisioning_pending/);
  assert.match(migration, /desired_updated_at/);
  assert.match(migration, /status = any/);
  assert.match(migration, /credentials\.updated_at = \(state ->> 'desired_updated_at'\)::timestamptz/);
  assert.match(migration, /if not public\.request_is_service_role\(\)/);
});
