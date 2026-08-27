import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readMigration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = readMigration("20260827195953_scope_live_operations_by_supervisor.sql");
const previousQueue = readMigration("20260807220000_queue_health_outbound_metrics.sql");
const previousAgent = readMigration("20260731180841_admin_force_agent_logout.sql");
const normalize = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

test("supervisor scoping leaves every queue calculation and return column unchanged", () => {
  const returnShape = (sql: string) => normalize(sql.match(/returns table\(([\s\S]*?)\)\s*language/)![1]);
  const metrics = (sql: string) => normalize(sql.match(/return query\s+select([\s\S]*?)from public\.dialer_campaign_configs/)![1]);
  assert.equal(returnShape(migration), returnShape(previousQueue));
  assert.equal(metrics(migration), metrics(previousQueue));
  assert.match(migration, /dc\.is_active = true\s+and \(v_role = 'admin'::public\.app_role or dc\.campaign_id = any\(v_campaign_ids\)\)/);
});

test("the live agent RPC retains its response shape and actual latest state", () => {
  const shape = (sql: string) => normalize(sql.match(/function public\.get_agent_live_status\(\)\s*returns table \(([\s\S]*?)\)\s*language/)![1]);
  assert.equal(shape(migration), shape(previousAgent));
  assert.match(migration, /where p\.role = 'agente' and p\.active\s+and \(v_role = 'admin'::public\.app_role or p\.team_id = any\(v_team_ids\)\)/);
  assert.match(migration, /then phone\.campaign_id else null end/);
  assert.match(migration, /order by session\.updated_at desc\s+limit 1/);
});

test("both definer RPCs check the active actor and session, and use explicit team scope", () => {
  assert.equal((migration.match(/if auth\.uid\(\) is null/g) ?? []).length, 2);
  assert.equal((migration.match(/not coalesce\(public\.is_current_app_session_valid\(\), false\)/g) ?? []).length, 2);
  assert.equal((migration.match(/actor\.id = auth\.uid\(\) and actor\.active/g) ?? []).length, 2);
  assert.equal((migration.match(/v_team_ids := public\.supervised_team_ids\(\)/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /from public\.get_report_scope_campaigns\(\)/);
  assert.match(migration, /revoke all on function public\.get_queue_health\(\) from public, anon/);
  assert.match(migration, /revoke all on function public\.get_agent_live_status\(\) from public, anon/);
});
