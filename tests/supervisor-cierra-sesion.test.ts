import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migracion = read("supabase/migrations/20260925040000_supervisor_cierra_sesion_de_ejecutivos.sql");
const accion = read("src/app/actions/supervision.ts");

test("el supervisor puede cerrar sesión, pero solo de ejecutivos de sus equipos", () => {
  assert.match(migracion, /create or replace function public\.force_agent_logout_sin_empresa\(/);
  assert.match(migracion, /v_actor_role not in \('admin'::public\.app_role, 'supervisor'::public\.app_role\)/);
  assert.match(
    migracion,
    /v_actor_role = 'supervisor'::public\.app_role\s+and not coalesce\(v_target\.team_id = any\(public\.supervised_team_ids\(\)\), false\)/,
  );
});

test("la función interna sigue cerrada para los clientes", () => {
  assert.match(migracion, /revoke execute on function public\.force_agent_logout_sin_empresa\(uuid, text\)\s+from public, anon, authenticated/);
});

test("la acción de servidor admite al supervisor", () => {
  const cuerpo = accion.slice(accion.indexOf("export async function forceAgentLogout"));
  assert.match(cuerpo, /requireProfile\(\["admin", "supervisor"\]\)/);
});
