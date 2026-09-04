import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard auth is deduplicated across nested server layouts", () => {
  const source = read("src/lib/auth.ts");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const getCurrentProfile = cache\(/);
});

test("campaign and operation menus do not block on catalog-wide exact counts", () => {
  const campaigns = read("src/app/dashboard/campanas/page.tsx");
  const operation = read("src/app/dashboard/operacion/page.tsx");
  assert.doesNotMatch(campaigns, /leadCounts|countByCampaign|count: "exact"/);
  assert.doesNotMatch(operation, /count: "exact"/);
});

test("lead navigation uses planned pagination and role-exclusive RLS", () => {
  const query = read("src/lib/leads-query.ts");
  const policy = read("supabase/migrations/20260904183023_optimize_leads_role_policy_evaluation.sql");
  assert.match(query, /count: "planned"/);
  assert.match(policy, /case \(select public\.current_role_name\(\)\)/);
  assert.match(policy, /team_id in \(select unnest\(\(select public\.supervised_team_ids\(\)\)\)\)/);
});
