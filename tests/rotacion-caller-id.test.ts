// Rotación del número que ve el cliente (caller ID).
//
// La contactabilidad de Equifax ronda el 14 % con un solo número. Se pedirán
// más a Siptel para rotarlos y medir cada uno; mientras haya uno solo nada
// cambia. El comportamiento SQL se prueba en tests/sql/discador/escenarios.sql
// (sección 15); aquí se vigila que las piezas sigan en su lugar sin base.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { callerIdPool, pickCallerId } from "../dialer-engine/src/dialer/callerId.ts";
import { MAX_CALLER_IDS, parseCallerIdList } from "../src/lib/caller-ids.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const MIGRACION = soloCodigo(leer("supabase/migrations/20260926160000_rotacion_de_caller_id.sql"));
const LOOP = leer("dialer-engine/src/dialer/campaignLoop.ts");
const CLIENTE = leer("dialer-engine/src/supabaseClient.ts");
const ACCION = leer("src/app/actions/dialer-config.ts");
const PANTALLA = leer("src/app/dashboard/admin/campanas/[id]/discado/page.tsx");
const PRUEBA_SQL = leer("scripts/probar-discador-sql.sh");

const funcion = (nombre: string) => {
  const inicio = MIGRACION.indexOf(`create or replace function public.${nombre}(`);
  assert.notEqual(inicio, -1, `falta ${nombre}`);
  return MIGRACION.slice(inicio, MIGRACION.indexOf("$$;", inicio));
};

test("la migración es idempotente y no toca las funciones críticas del discador", () => {
  assert.match(MIGRACION, /alter table public\.dialer_campaign_configs\s+add column if not exists caller_ids text\[\]/);
  assert.match(MIGRACION, /alter table public\.dial_attempts\s+add column if not exists caller_id text/);
  assert.match(MIGRACION, /drop trigger if exists dialer_campaign_configs_normalize_caller_ids/);
  assert.match(MIGRACION, /if not exists \(\s*select 1 from pg_constraint\s+where conname = 'dialer_configs_caller_ids_check'/);
  assert.match(MIGRACION, /create index if not exists dial_attempts_campaign_created_idx/);
  // El número se registra aparte: claim y register_dial_event quedan como están.
  assert.doesNotMatch(MIGRACION, /function public\.claim_next_dial_targets/);
  assert.doesNotMatch(MIGRACION, /function public\.register_dial_event/);
});

test("la lista se guarda en el formato que exige Siptel", () => {
  assert.match(funcion("dialer_normalize_caller_ids"), /public\.canonical_chile_phone\(valor\)/);
  assert.match(MIGRACION, /\^56\[2-9\]\[0-9\]\{8\}\(,56\[2-9\]\[0-9\]\{8\}\)\*\$/);
  assert.match(MIGRACION, /cardinality\(caller_ids\) between 1 and 50/);
});

test("solo el motor registra el número y no despierta los triggers de estado", () => {
  const registro = funcion("record_dial_attempt_caller_ids");
  assert.match(registro, /security definer/);
  assert.match(registro, /attempt\.caller_id is null/);
  assert.doesNotMatch(registro, /set status|status =/);
  assert.match(MIGRACION, /revoke all on function public\.record_dial_attempt_caller_ids\(uuid\[\], text\[\]\) from public, anon, authenticated/);
  assert.match(MIGRACION, /grant execute on function public\.record_dial_attempt_caller_ids\(uuid\[\], text\[\]\) to service_role/);
});

test("el informe por número tiene la frontera de empresa y cuenta en hora Chile", () => {
  const informe = funcion("get_caller_id_contactability");
  assert.match(informe, /security definer/);
  assert.match(informe, /perform public\.assert_org_access\(public\.org_of_campaign\(p_campaign_id\)\)/);
  assert.match(informe, /public\.can_access_org\(c\.organization_id\)/);
  assert.match(informe, /get_report_scope_campaigns\(\)/);
  assert.match(informe, /v_role not in \('admin', 'supervisor'\)/);
  assert.match(informe, /at time zone 'America\/Santiago'\)::date/);
  assert.match(informe, /attempt\.originated_at is not null/);
  assert.match(informe, /attempt\.bridged_at is not null/);
  assert.match(MIGRACION, /revoke all on function public\.get_caller_id_contactability\(date, date, uuid\) from public, anon/);
});

test("la migración corre en la prueba SQL del discador", () => {
  assert.match(PRUEBA_SQL, /20260926160000_rotacion_de_caller_id\.sql/);
});

test("el motor elige el número por lead y lo registra sin frenar el discado", () => {
  assert.match(LOOP, /caller_ids: string\[\] \| null/);
  assert.match(LOOP, /callerId: assignments\[index\]\.callerId/);
  assert.match(LOOP, /callerId: callbackCallerIds\[index\]\.callerId/);
  assert.doesNotMatch(LOOP, /callerId: cfg\.caller_id/);
  assert.match(CLIENTE, /supabase\.rpc\("record_dial_attempt_caller_ids"/);
  // Con un solo número el motor presenta exactamente lo de siempre.
  const pool = callerIdPool({ caller_id: "56965906926", caller_ids: null });
  assert.equal(pickCallerId(pool, "cualquier-lead"), "56965906926");
});

test("la pantalla de discado lee y valida la lista", () => {
  assert.deepEqual(parseCallerIdList(""), []);
  assert.deepEqual(parseCallerIdList("+56 9 6590 6926\n965906926, 56965906926; (2) 2345 6789\n\n"), [
    "56965906926",
    "56223456789",
  ]);
  assert.throws(() => parseCallerIdList("+1 650 706 2614"), /no es un número chileno válido/);
  assert.throws(() => parseCallerIdList("56 1234 5678"), /no es un número chileno válido/);
  const muchos = Array.from({ length: MAX_CALLER_IDS + 1 }, (_, i) => `5691${String(i).padStart(7, "0")}`).join("\n");
  assert.throws(() => parseCallerIdList(muchos), /hasta 50/);
  assert.match(ACCION, /parseCallerIdList\(String\(formData\.get\("caller_ids"\)/);
  assert.match(ACCION, /callerIdsSupported \? \{ caller_ids:/);
  assert.match(PANTALLA, /name="caller_ids"/);
  assert.match(PANTALLA, /name="caller_ids_supported"/);
});
