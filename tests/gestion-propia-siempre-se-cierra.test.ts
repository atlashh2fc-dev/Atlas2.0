import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const MIGRATIONS_DIR = "supabase/migrations";
const migrations = readdirSync(MIGRATIONS_DIR)
  .sort()
  .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8") }));

/** Última migración que contiene el patrón, en orden de aplicación. */
function latest(pattern: RegExp) {
  const owner = [...migrations].reverse().find((migration) => pattern.test(migration.sql));
  assert.ok(owner, `Ninguna migración contiene ${pattern}`);
  return owner;
}

// 14-10-2026: a Karina Halaby la cola de correo le pasó la respuesta de un
// cliente de Ximena Cofre. Abrió la gestión por correo y no podía cerrarla: la
// RLS le escondía su propia llamada y save_call_management no podía tocar un
// registro ajeno. La ficha la mandaba a tipificar a la misma ficha, sin fin.

test("el ejecutivo siempre ve su propia gestión abierta", () => {
  const owner = latest(/create policy calls_select on public\.calls/);
  const policy = owner.sql.slice(owner.sql.search(/create policy calls_select on public\.calls/));
  const body = policy.slice(0, policy.indexOf(");\n") + 2);
  assert.match(body, /agent_id = \(select auth\.uid\(\)\) and ended_at is null/);
});

test("cerrar la gestión no depende de que el registro esté a nombre de quien la abrió", () => {
  const owner = latest(/v_mantiene_dueno/);
  // Se parcha sobre la definición viva y aborta si no es la esperada.
  assert.match(owner.sql, /public\.save_call_management\(uuid,uuid,text,text,text,text,timestamp with time zone,text,text\[\],numeric,text,numeric\)/);
  assert.match(owner.sql, /raise exception[\s\S]*no coincide con la versión esperada/);
  // Con permisos de definidor, la empresa se comprueba a mano.
  assert.match(owner.sql, /security definer set search_path = pg_catalog, public/);
  assert.match(owner.sql, /perform public\.assert_org_access\(v_lead\.organization_id\)/);
  // Sobre un cliente ajeno, el registro y su agenda siguen con su dueño.
  assert.match(owner.sql, /managed_by = case when v_mantiene_dueno then managed_by else v_user_id end/);
  assert.match(owner.sql, /when v_mantiene_dueno then coalesce\(v_lead\.managed_by, v_lead\.assigned_to\)/);
});

test("la ficha de una gestión por correo abierta no se pierde al vencer el correo", () => {
  const owner = latest(/create or replace function public\.leads_de_mis_correos\(/);
  const definition = owner.sql.slice(owner.sql.search(/create or replace function public\.leads_de_mis_correos\(/));
  const body = definition.slice(0, definition.indexOf("$$;") + 3);
  assert.match(body, /gestion\.ended_at is null/);
  assert.match(body, /gestion\.management_channel = 'correo'/);
});
