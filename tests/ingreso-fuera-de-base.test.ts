// Ingreso fuera de base (Atlas 1: "Nuevo contacto" del supervisor).
//
// Contrato de lo que no puede volver atrás: RUT con dígito verificador,
// duplicado por campaña (no global) y la guardia de empresa de por medio.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const MIGRACION = soloCodigo(leer("supabase/migrations/20260925200000_ingreso_fuera_de_base.sql"));
const ACCION = leer("src/app/actions/manual-records.ts");
const FORMULARIO = leer("src/components/manual-lead-record-form.tsx");

test("el RUT se valida en la base, no solo en la pantalla", () => {
  assert.match(MIGRACION, /create or replace function public\.rut_es_valido\(p_rut text\)/);
  assert.match(MIGRACION, /if v_rut is not null and not public\.rut_es_valido\(v_rut\) then/);
});

test("duplicado es el mismo RUT en la misma campaña, como el índice único", () => {
  assert.match(
    MIGRACION,
    /coalesce\(l\.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid\)\s*=\s*coalesce\(p_campaign_id, '00000000-0000-0000-0000-000000000000'::uuid\)/
  );
  assert.match(MIGRACION, /upper\(regexp_replace\(l\.rut, '\[\^0-9kK\]', '', 'g'\)\) = v_normalized_rut/);
  // La búsqueda global por ficha maestra ya no decide el duplicado.
  assert.doesNotMatch(MIGRACION, /where e\.normalized_rut = v_normalized_rut/);
});

test("el registro queda marcado como fuera de base", () => {
  assert.match(MIGRACION, /'fuera_de_base', true/);
  assert.match(MIGRACION, /jsonb_build_object\('ingreso_manual', v_detalle\)/);
});

test("la pantalla entra por la envoltura con guardia de empresa", () => {
  assert.match(MIGRACION, /v_result := public\.create_manual_lead_record\(/);
  assert.match(MIGRACION, /revoke all on function public\.ingresar_lead_fuera_de_base\([^)]*\) from public, anon;/);
  assert.match(ACCION, /requireProfile\(\["supervisor", "admin"\]\)/);
  assert.match(ACCION, /supabase\.rpc\("ingresar_lead_fuera_de_base"/);
});

test("campaña y RUT son obligatorios, y el formulario no se borra al fallar", () => {
  assert.match(MIGRACION, /if p_campaign_id is null then/);
  assert.match(ACCION, /if \(!rutInput\) return/);
  assert.match(ACCION, /if \(!campaignId\) return/);
  assert.match(ACCION, /formatRut\(rutInput\)/);
  assert.doesNotMatch(FORMULARIO, /<option value="">Sin campaña<\/option>/);
  assert.doesNotMatch(FORMULARIO, /<form action=/);
});

const CON_BIGDATA = soloCodigo(leer("supabase/migrations/20260925210000_ingreso_fuera_de_base_con_bigdata.sql"));
const CONSULTA = leer("src/app/actions/bigdata-lookup.ts");

test("Bigdata se consulta por el puente firmado existente, sin llaves nuevas", () => {
  assert.match(CONSULTA, /integrationV2Destinations\(process\.env\.INTEGRATION_OUTBOX_DESTINATIONS_JSON\)\.get\("bigdata"\)/);
  assert.match(CONSULTA, /"x-atlas-source": "atlas2"/);
  assert.match(CONSULTA, /integrationV2Signature\(destino\.secret, timestamp/);
  assert.match(CONSULTA, /\/api\/commercial-intelligence\/atlas-bridge\/ficha-rut/);
  assert.match(CONSULTA, /requireProfile\(\["supervisor", "admin"\]\)/);
  assert.doesNotMatch(CONSULTA, /BIGDATA_|SERVICE_ROLE/);
});

test("la ficha guarda dirección, rubro y de dónde salió el dato", () => {
  assert.match(
    CON_BIGDATA,
    /item\.key in \('nombre_contacto', 'comuna', 'region', 'direccion', 'rubro', 'producto', 'completado_con'\)/
  );
  assert.match(CON_BIGDATA, /v_result := public\.create_manual_lead_record\(/);
});

const AGENDA = soloCodigo(leer("supabase/migrations/20260925220000_ingreso_asignado_queda_en_agenda.sql"));
const MI_AGENDA = leer("src/app/dashboard/agenda/page.tsx");

test("asignado a un ejecutivo, el registro queda en su agenda personal", () => {
  // Mi agenda filtra por managed_by y next_action_at: sin eso el ejecutivo no lo ve.
  assert.match(MI_AGENDA, /\.eq\("managed_by", profile\.id\)/);
  assert.match(MI_AGENDA, /\.not\("next_action_at", "is", null\)/);
  assert.match(AGENDA, /set managed_by = p_assigned_to,\s*next_action_at = v_agenda_at,/);
  // Lo que exige claim_due_personal_callbacks para marcarlo a la hora.
  assert.match(AGENDA, /workflow_status = 'callback'/);
  assert.match(AGENDA, /callback_mode = 'personal'/);
  assert.match(AGENDA, /next_action_channel = 'phone'/);
  // Una hora pasada no la marcaría nadie: se agenda ya.
  assert.match(AGENDA, /greatest\(coalesce\(p_agenda_at, now\(\)\), now\(\)\)/);
  assert.match(ACCION, /p_agenda_at: agendaAt\?\.toISOString\(\) \?\? null/);
  assert.match(ACCION, /parseDateTimeInput\(agendaInput\)/);
});
