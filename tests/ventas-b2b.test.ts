// Embudo B2B: lo que no puede cambiar sin pensarlo dos veces.
//
// Vender Atlas Pulso es otra forma de trabajo que la del call center: hay una
// empresa cliente, un monto mensual, una etapa y una próxima acción. Estas
// pruebas vigilan que ese modelo nazca con la frontera de empresa puesta y que
// las reglas de negocio vivan en la base, no en la pantalla.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migracion = (nombre: string) =>
  readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");

const NUCLEO = migracion("20260917200000_nucleo_de_ventas_b2b.sql");
const OPERACIONES = migracion("20260917200100_operaciones_de_ventas_b2b.sql");
const EMPRESA_ACTIVA = migracion("20260917200200_empresa_activa_manda_al_crear.sql");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const TABLAS = [
  "sales_companies",
  "sales_contacts",
  "sales_stages",
  "sales_products",
  "sales_opportunities",
  "sales_opportunity_items",
  "sales_activities",
];

test("cada tabla de ventas nace con empresa dueña", () => {
  const codigo = soloCodigo(NUCLEO);
  for (const tabla of TABLAS) {
    assert.match(codigo, new RegExp(`create table if not exists public\\.${tabla}`), `falta ${tabla}`);
  }
  const columnas = [...codigo.matchAll(/organization_id uuid not null default public\.default_organization_id\(\)/g)];
  assert.equal(columnas.length, TABLAS.length, "todas las tablas deben declarar su empresa dueña");
});

test("las tablas de ventas quedan aisladas por empresa, no solo por rol", () => {
  const codigo = soloCodigo(NUCLEO);
  assert.match(codigo, /as restrictive for all to authenticated/);
  assert.match(codigo, /public\.is_platform_owner\(\) or organization_id = any \(public\.current_org_ids\(\)\)/);
  assert.match(codigo, /_organization_isolation/);
  // El embudo lo mueven administración y supervisión; un agente no lo ve.
  assert.match(codigo, /'admin'::public\.app_role, 'supervisor'::public\.app_role/);
});

test("el embudo y el catálogo nacen sembrados", () => {
  const codigo = soloCodigo(NUCLEO);
  for (const etapa of ["prospecto", "contactado", "reunion", "propuesta", "negociacion", "ganada", "perdida"]) {
    assert.match(codigo, new RegExp(`'${etapa}'`), `falta la etapa ${etapa}`);
  }
  // Precios públicos de Atlas Pulso: si cambian en el sitio, cambian acá.
  assert.match(codigo, /'pulso_esencial'[\s\S]*29990/);
  assert.match(codigo, /'pulso_crecimiento'[\s\S]*69990/);
  assert.match(codigo, /'pulso_pro'[\s\S]*149990/);
  assert.match(codigo, /public\.organization_id_by_slug\('altius'\)/);
});

test("crear, mover y registrar viven en la base y comprueban la empresa", () => {
  const codigo = soloCodigo(OPERACIONES);
  assert.match(codigo, /create or replace function public\.crear_oportunidad_b2b/);
  assert.match(codigo, /create or replace function public\.mover_oportunidad_de_etapa/);
  assert.match(codigo, /create or replace function public\.registrar_actividad_b2b/);
  // La empresa sale de quien opera, nunca de un parámetro del cliente.
  assert.match(codigo, /v_org uuid := public\.current_org_id\(\)/);
  assert.doesNotMatch(codigo, /p_organization_id/);
  // Mover y registrar comprueban la empresa del dato que reciben.
  assert.equal([...codigo.matchAll(/perform public\.assert_org_access\(v_oportunidad\.organization_id\)/g)].length, 2);
  // Ganar o perder cierra el negocio sin que la pantalla tenga que acordarse.
  assert.match(codigo, /when v_etapa\.is_won then 'ganada' when v_etapa\.is_lost then 'perdida'/);
  assert.match(codigo, /closed_at = case when v_etapa\.is_won or v_etapa\.is_lost then now\(\)/);
  // Una gestión con fecha futura es la próxima acción del negocio.
  assert.match(codigo, /set next_action_at = p_due_at/);
});

test("ninguna función de ventas queda abierta a visitantes sin sesión", () => {
  const codigo = soloCodigo(OPERACIONES);
  for (const funcion of ["crear_oportunidad_b2b", "mover_oportunidad_de_etapa", "registrar_actividad_b2b"]) {
    assert.match(codigo, new RegExp(`public\\.${funcion}\\(`), `falta ${funcion}`);
  }
  assert.match(codigo, /revoke execute on function %s from anon/);
  assert.match(codigo, /grant execute on function %s to authenticated, service_role/);
});

test("la empresa que se está mirando manda también al crear", () => {
  const codigo = soloCodigo(EMPRESA_ACTIVA);
  assert.match(codigo, /create or replace function public\.current_org_id/);
  assert.match(codigo, /viewing_organization_id/);
  assert.match(codigo, /platform_owners/);
});
