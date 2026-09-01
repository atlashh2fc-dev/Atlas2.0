import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const campaignPage = readFileSync(
  new URL("../src/app/dashboard/admin/campanas/[id]/page.tsx", import.meta.url),
  "utf8",
);
const campaignActions = readFileSync(
  new URL("../src/app/actions/campaigns.ts", import.meta.url),
  "utf8",
);
const mailActions = readFileSync(
  new URL("../src/app/actions/mail.ts", import.meta.url),
  "utf8",
);
const mailPage = readFileSync(
  new URL("../src/app/dashboard/mail/page.tsx", import.meta.url),
  "utf8",
);
const mailControl = readFileSync(
  new URL("../src/components/mail-control-center.tsx", import.meta.url),
  "utf8",
);

test("admin conecta Atlas Lead a una campaña CRM existente", () => {
  assert.match(campaignPage, /title="Atlas Lead"/);
  assert.match(campaignPage, /name="external_campaign_key"/);
  assert.match(campaignPage, /name="routing_team_id"/);
  assert.match(campaignPage, /después de la confirmación segura de Atlas Lead/);
  assert.match(campaignPage, /Lista para recibir/);
  assert.match(campaignActions, /rpc\("map_atlas_lead_mail_campaign"/);
  assert.match(campaignActions, /campaign-readiness/);
  assert.match(campaignActions, /integrations\/outbox\/backfill/);
  assert.match(campaignActions, /maxBatches", "20"/);
  assert.match(campaignActions, /payload\.complete !== true/);
  assert.match(campaignActions, /confirm_atlas_lead_mail_campaign_handshake/);
  assert.match(campaignActions, /ATLAS_LEAD_INTEGRATION_URL/);
  assert.match(campaignActions, /redirect: "error"/);
  assert.match(campaignActions, /p_campaign_id: campaignId/);
  assert.match(campaignActions, /routing_team_id: routingTeamId/);
  assert.doesNotMatch(campaignActions, /mapAtlasLeadMailCampaign[\s\S]*?\.from\("campaigns"\)\.insert/);
});

test("asignación mail individual y masiva usan la misma transacción", () => {
  const calls = mailActions.match(/rpc\("assign_mail_engagement_opportunities"/g) ?? [];
  assert.equal(calls.length, 2);
  assert.doesNotMatch(mailActions, /for \(const leadId of ids\)/);
  assert.doesNotMatch(mailActions, /mail_engagement\.bulk_assign/);
  assert.match(mailActions, /ids\.length > MAIL_BULK_ASSIGNMENT_MAX/);
});

test("el selector sólo ofrece ejecutivos habilitados para campañas y equipos de la selección", () => {
  assert.match(mailPage, /\.from\("campaign_agents"\)\.select\("campaign_id, profile_id"\)/);
  assert.match(mailPage, /\.from\("leads"\)\.select\("id,team_id"\)/);
  assert.match(mailControl, /assignmentCampaignIds\.every/);
  assert.match(mailControl, /assignmentTeamIds\.every/);
});
