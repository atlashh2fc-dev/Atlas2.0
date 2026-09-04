import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hardening = readFileSync(
  "supabase/migrations/20260904143000_optimize_supervisor_report_rls.sql",
  "utf8",
);
const scopedDefinition = readFileSync(
  "supabase/migrations/20260731113000_supervisor_reporting_multi_team_campaign_scope.sql",
  "utf8",
);

test("el reporte evita RLS duplicada sin ampliar el alcance del supervisor", () => {
  assert.match(hardening, /security definer/i);
  assert.match(hardening, /set search_path = pg_catalog, public/i);
  assert.match(hardening, /revoke all[\s\S]*from public, anon;/i);
  assert.match(hardening, /grant execute[\s\S]*to authenticated;/i);
  assert.doesNotMatch(hardening, /statement_timeout/i);

  assert.match(scopedDefinition, /if \(select auth\.uid\(\)\) is null/i);
  assert.match(scopedDefinition, /v_role = 'supervisor'/i);
  assert.match(scopedDefinition, /p_team_id = any\(v_team_ids\)/i);
  assert.match(scopedDefinition, /l\.team_id = any\(v_team_ids\)/i);
});
