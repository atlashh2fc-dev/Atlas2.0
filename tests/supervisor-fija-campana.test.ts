// Multiskill gobernado por el supervisor: prioridad por ejecutivo y campaña fijada
// que solo quien la fijó (o un admin) puede mover.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20260924144409_supervisor_prioriza_y_fija_campana.sql", import.meta.url),
  "utf8"
).replace(/--[^\n]*/g, "");

const funcion = (nombre: string) => {
  const inicio = sql.indexOf(`create or replace function public.${nombre}(`);
  assert.notEqual(inicio, -1, `falta ${nombre}`);
  return sql.slice(inicio, sql.indexOf("$$;", inicio));
};

test("el ejecutivo no puede salir de una campaña fijada", () => {
  const cuerpo = funcion("set_my_active_campaign");
  assert.match(cuerpo, /perform public\.assert_org_access\(public\.org_of_campaign\(p_campaign_id\)\)/);
  assert.match(cuerpo, /where active\.profile_id = v_actor_id and active\.locked/);
  assert.match(cuerpo, /Solo quien la asignó puede cambiarla/);
});

test("solo quien fijó la campaña o un admin puede moverla o liberarla", () => {
  const guardia = funcion("assert_can_change_agent_campaign");
  assert.match(guardia, /public\.can_supervise_agent\(p_profile_id\)/);
  assert.match(guardia, /v_lock\.assigned_by is distinct from \(select auth\.uid\(\)\)/);
  assert.match(guardia, /<> 'admin'::public\.app_role/);
  assert.match(funcion("supervisor_set_agent_campaign"), /perform public\.assert_can_change_agent_campaign\(p_profile_id\)/);
  assert.match(funcion("supervisor_release_agent_campaign"), /perform public\.assert_can_change_agent_campaign\(p_profile_id\)/);
});

test("el supervisor solo alcanza a sus equipos y el admin solo a su empresa", () => {
  const alcance = funcion("can_supervise_agent");
  assert.match(alcance, /agent\.team_id = any \(public\.supervised_team_ids\(\)\)/);
  assert.match(alcance, /public\.can_access_org\(agent\.organization_id\)/);
  assert.match(funcion("supervisor_agent_campaign_board"), /public\.can_supervise_agent\(agent\.id\)/);
  assert.match(funcion("supervisor_set_agent_campaign_priorities"), /public\.can_supervise_agent\(p_profile_id\)/);
});

test("la prioridad solo decide si el ejecutivo no eligió y hay una sola primera", () => {
  const cuerpo = funcion("ensure_my_active_campaign");
  assert.match(cuerpo, /v_current\.locked or v_current\.source = 'agente'/);
  assert.match(cuerpo, /v_top_count <> 1/);
});

test("nadie cambia de cola con una llamada o tipificación en curso, y cada cambio queda registrado", () => {
  const cuerpo = funcion("apply_agent_active_campaign");
  assert.match(cuerpo, /session\.status in \('ringing', 'on_call', 'wrap_up'\)/);
  assert.match(cuerpo, /insert into public\.agent_campaign_switches/);
  assert.match(sql, /revoke all on function public\.apply_agent_active_campaign\(uuid, uuid, text, boolean, uuid\) from public, anon, authenticated/);
});

test("la prioridad no se salta los horarios ni toca a quien tiene una sola campaña", () => {
  const correccion = readFileSync(
    new URL("../supabase/migrations/20260924152541_prioridad_respeta_horarios.sql", import.meta.url),
    "utf8"
  ).replace(/--[^\n]*/g, "");
  assert.match(correccion, /v_eligible < 2 or v_scheduled > 0/);
  assert.match(correccion, /public\.campaign_agent_schedules schedule where schedule\.campaign_agent_id = eligible\.id/);
});
