import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260904171520_support_multi_supervisor_omnichannel_operations.sql", import.meta.url),
  "utf8",
);

const applicationFiles = [
  "../src/app/dashboard/page.tsx",
  "../src/app/dashboard/admin/cargas/page.tsx",
  "../src/app/dashboard/calidad/grabaciones/page.tsx",
  "../src/app/dashboard/campanas/[id]/correo/page.tsx",
  "../src/app/dashboard/leads/nuevo/page.tsx",
  "../src/app/dashboard/mail/page.tsx",
  "../src/lib/quality-recordings.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("el alcance supervisor es muchos-a-muchos y conserva compatibilidad legacy", () => {
  assert.match(migration, /create table public\.team_supervisors/);
  assert.match(migration, /primary key \(team_id, supervisor_id\)/);
  assert.match(migration, /team_supervisors_supervisor_idx/);
  assert.match(migration, /alter table public\.team_supervisors enable row level security/);
  assert.match(migration, /team\.supervisor_id = actor\.id\s+or exists/);
  assert.match(migration, /create or replace function public\.supervised_team_ids\(\)/);
});

test("Andrea y Elizabeth quedan asociadas a la misma Secretaría Virtual sin IDs generados", () => {
  assert.match(migration, /lower\(supervisor\.email\) = 'aguerra@infobusiness\.cl'/);
  assert.match(migration, /where team\.name = 'Secretaria Virtual'/);
  assert.match(migration, /insert into public\.team_supervisors \(team_id, supervisor_id\)\s+select team\.id, team\.supervisor_id/);
  assert.doesNotMatch(migration, /e75a37ea|d5bd5b76|04336514/);
});

test("las escrituras administrativas son transaccionales, validadas y auditables", () => {
  assert.match(migration, /private\.replace_team_supervisors/);
  assert.match(migration, /private\.set_user_role_and_team_scope/);
  assert.match(migration, /public\.is_current_app_session_valid\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /profile\.role = 'supervisor'/);
  assert.match(migration, /revoke all on function public\.replace_team_supervisors/);
});

test("la aplicación dejó de filtrar equipos por el supervisor singular", () => {
  assert.doesNotMatch(applicationFiles, /eq\(["']supervisor_id["']/);
  assert.match(applicationFiles, /getSupervisedTeamIds/);
});
