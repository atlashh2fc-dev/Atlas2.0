import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260904152747_automate_campaign_agent_operational_onboarding.sql",
    import.meta.url
  ),
  "utf8"
);
const userAssignments = readFileSync(
  new URL("../src/app/actions/campaign-assignments.ts", import.meta.url),
  "utf8"
);
const campaignAssignments = readFileSync(
  new URL("../src/app/actions/campaigns.ts", import.meta.url),
  "utf8"
);
const sipDiagnosticsPage = readFileSync(
  new URL("../src/app/dashboard/admin/agentes-sip/page.tsx", import.meta.url),
  "utf8"
);
const navigation = readFileSync(new URL("../src/lib/nav.config.ts", import.meta.url), "utf8");
const userCampaignsForm = readFileSync(
  new URL("../src/components/user-campaigns-form.tsx", import.meta.url),
  "utf8"
);

test("campaign assignment is the single operational onboarding command", () => {
  assert.match(migration, /campaign_agents_operational_onboarding/);
  assert.match(migration, /insert into public\.agent_sip_credentials/);
  assert.match(migration, /insert into public\.agent_active_campaigns/);
  assert.match(migration, /insert into public\.contact_center_queue_members/);
  assert.match(migration, /config\.campaign_type = 'outbound'/);
});

test("new assignments do not wait for an extra schedule form", () => {
  assert.doesNotMatch(userAssignments, /schedule_required:\s*true/);
  assert.doesNotMatch(campaignAssignments, /schedule_required:\s*true/);
  assert.match(userAssignments, /schedule_required:\s*false/);
  assert.match(campaignAssignments, /schedule_required:\s*false/);
});

test("the CRM presents SIP as automatic and keeps manual controls as contingency only", () => {
  assert.match(navigation, /label: "Telefonía · diagnóstico"/);
  assert.match(sipDiagnosticsPage, /Esta pantalla no es\s*parte del alta normal/);
  assert.match(sipDiagnosticsPage, /Acciones de contingencia/);
  assert.doesNotMatch(sipDiagnosticsPage, /provisionAgentExtension/);
  assert.doesNotMatch(sipDiagnosticsPage, />\s*Generar extensión\s*</);
  assert.match(userCampaignsForm, /Campañas asignadas/);
  assert.doesNotMatch(userCampaignsForm, /Skills habilitados/);
  assert.match(userCampaignsForm, /Atlas habilita telefonía, campaña activa y colas vinculadas/);
});
