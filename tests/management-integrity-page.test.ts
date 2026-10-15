import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/dashboard/reportes/integridad/page.tsx", import.meta.url), "utf8");
const tables = readFileSync(new URL("../src/components/management-integrity-tables.tsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/20261015200000_integridad_depurada.sql", import.meta.url),
  "utf8",
).replace(/--[^\n]*/g, "");

test("Integridad mantiene las funciones de tabla dentro del componente cliente", () => {
  assert.match(tables, /^"use client";/);
  assert.match(tables, /function agentColumns/);
  assert.match(tables, /const DETAIL_COLUMNS/);
  assert.match(page, /<ManagementIntegrityTables\s+agents=\{report\.agents\}\s+detail=\{report\.detail\}/);
  assert.doesNotMatch(page, /Column<Integrity/);
});

test("el reagendamiento sin contacto no se mezcla con lo que hay que revisar", () => {
  // 1.785 de 2.321 «marcadas» eran «Volver a llamar» sin conexión: un tema del
  // flujo. Mezclado, escondía los 344 casos que sí había que mirar.
  assert.match(migration, /es_volver_a_llamar/);
  assert.match(migration, /\(e\.status = 'connected' and not e\.hubo_conexion and not e\.es_volver_a_llamar\) as es_contacto_sin_conexion/);
  assert.match(migration, /\(m\.es_contacto_sin_conexion or m\.es_cierre_rapido or m\.es_rafaga\) as para_revisar/);
  assert.match(page, /Reagendadas sin contacto/);
});

test("la conexión se prueba con la llamada vinculada y con respuesta o puente", () => {
  // ~190 contactos reales quedaban marcados: el intento terminaba en `failed`
  // aunque la central había respondido y conectado.
  assert.match(migration, /da\.call_id = cerradas\.id/);
  assert.match(migration, /da\.answered_at is not null or da\.bridged_at is not null/);
});

test("Integridad conserva la frontera de empresa y el alcance del supervisor", () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /v_org_ids := array\(select o\.id from public\.organizations o where public\.can_access_org\(o\.id\)\)/);
  assert.match(migration, /\(v_team_ids is null or l\.team_id = any\(v_team_ids\)\)/);
  assert.match(migration, /and c\.legacy_call_id is null/);
  assert.match(migration, /and c\.discarded_reason is null/);
});

test("cada caso se explica en palabras y abre la ficha", () => {
  assert.match(tables, /explainIntegrityCase\(row\)/);
  assert.match(tables, /header: "Qué no calza"/);
  assert.match(tables, /rowHref=\{\(row\) => `\/dashboard\/leads\/\$\{row\.lead_id\}`\}/);
  // Tocar un ejecutivo baja a sus casos sin perder el período.
  assert.match(tables, /params\.set\("ejecutivo", agentId\)/);
});
