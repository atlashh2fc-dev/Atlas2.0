import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260901161832_native_atlas_lead_mail_operations.sql",
  "utf8",
);

function functionBody(name: string, nextMarker: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = migration.indexOf(nextMarker, start);
  assert.ok(start >= 0, `${name} debe existir`);
  assert.ok(end > start, `${name} debe terminar antes de ${nextMarker}`);
  return migration.slice(start, end);
}

test("mapping Atlas Lead es explícito, inmutable y no crea campañas CRM", () => {
  const mapping = functionBody("map_atlas_lead_mail_campaign", "-- Called only after");
  assert.match(mapping, /p_external_campaign_key text,[\s\S]*p_campaign_id uuid/);
  assert.match(mapping, /metadata\.routing_team_id es obligatorio/);
  assert.match(mapping, /campaign_agents/);
  assert.match(mapping, /agent\.active/);
  assert.match(mapping, /v_existing_campaign_id <> p_campaign_id/);
  assert.match(mapping, /ya está mapeada a otra campaña CRM/);
  assert.match(mapping, /where public\.mail_campaigns\.campaign_id = excluded\.campaign_id/);
  assert.doesNotMatch(mapping, /insert into public\.campaigns/);
  assert.match(mapping, /'mapping_status', 'registered'/);
  assert.match(mapping, /'readiness', 'pending_handshake'/);
});

test("handshake no infiere readiness y queda auditado", () => {
  const handshake = functionBody(
    "confirm_atlas_lead_mail_campaign_handshake",
    "-- Keep the legacy signature",
  );
  assert.match(handshake, /security definer[\s\S]*set search_path = ''/);
  assert.match(handshake, /source\.code = 'atlas_lead'/);
  assert.match(handshake, /mail_campaign\.handshake_confirmed/);
  assert.match(handshake, /'readiness', 'ready'/);
  assert.match(migration, /revoke all on function public\.confirm_atlas_lead_mail_campaign_handshake[\s\S]*from public, anon, authenticated/);
});

test("autorización separa catálogo de PII por equipo", () => {
  const leadScope = functionBody("can_supervise_mail_lead", "-- Explicit control-plane operation");
  assert.match(leadScope, /actor\.active/);
  assert.match(leadScope, /p_team_id = any\(public\.supervised_team_ids\(\)\)/);
  assert.match(leadScope, /count\(distinct agent\.team_id\)/);
  assert.match(leadScope, /agent\.active/);
  assert.match(migration, /public\.can_supervise_mail_lead\(s\.campaign_id, l\.team_id\)/);
  assert.match(migration, /mail_campaign_base_recipients\.campaign_id,[\s\S]*lead\.team_id/);
  assert.match(migration, /mail_result_contacts\.campaign_id,[\s\S]*lead\.team_id/);
});

test("asignación mail valida todo antes de mutar y es transaccional", () => {
  const assignment = functionBody(
    "assign_mail_engagement_opportunities",
    "-- Optional delivery/message detail",
  );
  const validation = assignment.indexOf("El ejecutivo destino no tiene habilitada");
  const teamValidation = assignment.indexOf("Una o más oportunidades pertenecen a otro equipo");
  const lock = assignment.indexOf("for update;");
  const firstMutation = assignment.indexOf("update public.lead_assignments");
  assert.ok(lock > 0 && validation > lock && teamValidation > validation);
  assert.ok(firstMutation > teamValidation);
  assert.match(assignment, /Every invariant below is re-read while the selected lead rows remain[\s\S]*with visible as/);
  assert.match(assignment, /cardinality\(v_lead_ids\) > 100/);
  assert.match(assignment, /public\.can_supervise_mail_lead\(status\.campaign_id, lead\.team_id\)/);
  assert.match(assignment, /membership\.profile_id = p_agent_id/);
  assert.match(assignment, /coalesce\(lead\.team_id, v_agent_team_id\)/);
  assert.match(assignment, /v_assigned_count <> cardinality\(v_lead_ids\)/);
  assert.doesNotMatch(assignment, /exception when/);
});

test("roster firmado sólo materializa tras mapping Atlas Lead explícito", () => {
  const roster = functionBody(
    "materialize_atlas_lead_mail_roster_item",
    "-- Atomic events increment",
  );
  assert.match(roster, /request_is_service_role/);
  assert.match(roster, /source\.code = 'atlas_lead'/);
  assert.match(roster, /mail_campaign\.external_campaign_key = v_external_campaign_key/);
  assert.match(roster, /pg_advisory_xact_lock/);
  assert.match(roster, /on conflict \(source_id, campaign_id, external_key\)/);
  assert.match(roster, /v_routing_team_id/);
  assert.match(migration, /item\.payload->>'event_kind'\), ''\) = 'sent'/);
  assert.match(migration, /join public\.integration_sources source[\s\S]*source\.code = 'atlas_lead'/);
});

test("proyección distingue evento atómico de snapshot y conserva timeline", () => {
  const projection = functionBody("apply_engagement_events_v2", "commit;");
  assert.match(projection, /event_semantics[\s\S]*atomic_event[\s\S]*cumulative_snapshot/);
  assert.match(projection, /event_kind' = 'opened'/);
  assert.match(projection, /then max\(opened::integer\)/);
  assert.match(projection, /greatest\(public\.lead_mail_status\.opened_count, excluded\.opened_count\)/);
  for (const field of [
    "external_campaign_key", "delivery_id", "message_id", "message_subject",
    "event_kind", "link_url", "provider_event_id",
  ]) {
    assert.match(projection, new RegExp(`'${field}', valid\\.${field}`));
  }
  assert.match(projection, /on conflict \(integration_item_id\)[\s\S]*do nothing/);
  assert.match(projection, /excluded\.last_seen_at >= public\.mail_campaign_lead_status\.last_seen_at/);
});

test("funciones SECURITY DEFINER sensibles tienen search_path y grants mínimos", () => {
  for (const name of [
    "can_supervise_campaign",
    "can_supervise_mail_lead",
    "map_atlas_lead_mail_campaign",
    "confirm_atlas_lead_mail_campaign_handshake",
    "assign_mail_engagement_opportunities",
    "materialize_atlas_lead_mail_roster_item",
    "apply_engagement_events_v2",
    "generate_atlas_lead_operation_feedback_v2",
  ]) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const end = migration.indexOf("$function$;", start);
    const body = migration.slice(start, end);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
  }
  assert.match(migration, /revoke all on function public\.materialize_atlas_lead_mail_roster_item\([\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.materialize_atlas_lead_mail_roster_item\([\s\S]*to service_role/);
});

test("migración es atómica y termina en commit", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
});

test("feedback Atlas Lead sale sólo tras tipificación completa y es idempotente", () => {
  const feedback = functionBody(
    "generate_atlas_lead_operation_feedback_v2",
    "commit;",
  );
  assert.match(feedback, /call\.ended_at is not null/);
  assert.match(feedback, /call\.discarded_reason is null/);
  assert.match(feedback, /call\.status[\s\S]*call\.outcome[\s\S]*call\.reason/);
  assert.match(feedback, /lead\.managed_at is not null/);
  assert.match(feedback, /lead\.assignment_status = 'managed'/);
  assert.match(feedback, /not exists \([\s\S]*integration_outbox_events/);
  assert.match(feedback, /on conflict \(destination_source_id, event_id\) do nothing/);
  assert.doesNotMatch(feedback, /integration_campaign_mappings/);
  for (const field of [
    "crm_campaign_id", "external_campaign_key", "source_lead_id", "outcome",
    "managed_at", "management_completed", "response_received", "do_not_contact",
  ]) {
    assert.match(feedback, new RegExp(`'${field}'`));
  }

  const assignment = functionBody(
    "assign_mail_engagement_opportunities",
    "-- Optional delivery/message detail",
  );
  assert.doesNotMatch(assignment, /operation\.feedback\.v1|integration_outbox_events/);
  const route = readFileSync("src/app/api/integrations/v2/feedback/generate/route.ts", "utf8");
  assert.match(route, /sourceCode === "atlas_lead"[\s\S]*generate_atlas_lead_operation_feedback_v2/);
  assert.match(route, /generate_operation_feedback_v2[\s\S]*p_destination_source_code: "bigdata"/);
  assert.match(route, /sourceCode !== "bigdata" && sourceCode !== "atlas_lead"/);
  assert.match(route, /Destino de feedback no soportado/);
  assert.ok(
    route.indexOf("Destino de feedback no soportado") < route.indexOf("const admin = createAdminClient()"),
    "un destino no soportado debe rechazarse antes de crear el cliente de base",
  );
});
