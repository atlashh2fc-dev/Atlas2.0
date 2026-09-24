// Discador del pool: horario y feriados por campaña, esperas por lead y por
// teléfono, fallas técnicas, topes, lista de no llamar y cortacircuitos.
//
// La auditoría del 24-09-2026 encontró que el progresivo volvía a marcar al
// mismo cliente en segundos (9 llamadas en 2,5 minutos en Secretaria Virtual)
// porque 'completed' sin contestar, 'abandoned' y el descarte técnico no
// contaban como intento; que discaba a cualquier hora; y que no había lista de
// no llamar. La revisión posterior pidió que una caída de la troncal no gaste
// los intentos del cliente y que ningún error quede escondido.
//
// El comportamiento se prueba de verdad en tests/sql/discador/escenarios.sql
// (más de cien reglas sobre un Postgres desechable); la última prueba de este
// archivo lo corre cuando hay PostgreSQL local o DISCADOR_PG_URL. Las demás
// vigilan que las piezas sigan en su lugar sin necesitar base.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { originateFailureEvent } from "../dialer-engine/src/ami/originateOutcome.ts";
import { DIALER_SUPPRESSION_LABELS, dialerSuppressionMessage } from "../src/lib/dialer-suppression.ts";

const leer = (ruta: string) =>
  readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
const migracion = (nombre: string) => leer(`supabase/migrations/${nombre}`);

const POLITICA = migracion("20260924181000_discador_horario_y_politica_de_reintentos.sql");
const NO_LLAMAR = migracion("20260924181100_lista_no_llamar.sql");
const ESPERA = migracion("20260924181200_espera_por_lead_y_por_telefono.sql");
const CLAIM = migracion("20260924181300_claim_respeta_horario_esperas_y_no_llamar.sql");
const VOZ_IA = migracion("20260924181400_voz_ia_respeta_no_llamar.sql");
const ACCIONES = readFileSync(new URL("../src/app/actions/calls.ts", import.meta.url), "utf8");
const RUTEADOR = readFileSync(new URL("../dialer-engine/src/ami/eventRouter.ts", import.meta.url), "utf8");

const funcion = (sql: string, nombre: string) => {
  const inicio = sql.indexOf(`create or replace function public.${nombre}(`);
  assert.notEqual(inicio, -1, `falta ${nombre}`);
  const fin = sql.indexOf("$$;", inicio);
  return sql.slice(inicio, fin === -1 ? sql.indexOf("$function$;", inicio) : fin);
};

test("el motor distingue 'sonó y nadie contestó' de una falla técnica del Originate", () => {
  assert.equal(originateFailureEvent("3"), "no_answer");
  assert.equal(originateFailureEvent("5"), "busy");
  assert.equal(originateFailureEvent("0"), "failed");
  assert.equal(originateFailureEvent("8"), "failed");
  assert.match(RUTEADOR, /eventType: success \? "originating" : originateFailureEvent\(evt\.reason\)/);
});

test("la base clasifica cada intento terminado como real, técnico o ignorado", () => {
  const clase = funcion(POLITICA, "dialer_attempt_result_class");
  assert.match(clase, /p_attempt_kind = 'personal_callback' and p_originated_at is null then 'ignorado'/);
  assert.match(clase, /p_status = 'failed' and p_originated_at is null then 'tecnico'/);
  assert.match(clase, /in \('34', '38', '41', '42', '47'\) then 'tecnico'/);
  assert.match(clase, /else 'real'/);
});

test("la franja y los feriados son por campaña, en hora Chile, y sin configurar no cambian a nadie", () => {
  const franja = funcion(POLITICA, "dialer_calling_window_open");
  assert.match(franja, /extract\(isodow from \(p_at at time zone 'America\/Santiago'\)\)/);
  const ventana = funcion(POLITICA, "dialer_campaign_in_calling_window");
  assert.match(ventana, /not \(config\.skip_holidays and public\.dialer_is_holiday\(campaign\.organization_id, now\(\)\)\)/);
  assert.match(ventana, /coalesce\([\s\S]*,\s*true\s*\)/);
  assert.doesNotMatch(ventana, /security definer/);
  assert.match(funcion(POLITICA, "dialer_is_holiday"), /\(p_at at time zone 'America\/Santiago'\)::date/);
  assert.match(POLITICA, /add column if not exists skip_holidays boolean not null default false/);
  assert.match(POLITICA, /add column if not exists technical_breaker_ratio numeric;/);
  assert.match(POLITICA, /\(null, '2026-09-18', 'Independencia Nacional'\)/);
});

test("Equifax queda L-V 09-19 sin feriados, tope 6 y cortacircuitos, sin tocar el encendido", () => {
  const equifax = POLITICA.slice(POLITICA.indexOf("update public.dialer_campaign_configs"));
  assert.match(equifax, /calling_days = '\{1,2,3,4,5\}'/);
  assert.match(equifax, /calling_start_time = '09:00'/);
  assert.match(equifax, /calling_end_time = '19:00'/);
  assert.match(equifax, /skip_holidays = true/);
  assert.match(equifax, /technical_breaker_ratio = 0\.8/);
  assert.match(equifax, /where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'/);
  for (const sql of [POLITICA, NO_LLAMAR, ESPERA, CLAIM, VOZ_IA]) {
    assert.doesNotMatch(sql, /is_active\s*=/);
  }
});

test("la espera separa el conteo del espaciado y no la acorta una gestión", () => {
  const calculo = funcion(ESPERA, "dialer_compute_lead_retry");
  // El ciclo reinicia contadores: gestión humana o devolución del supervisor.
  assert.match(calculo, /greatest\(\s*coalesce\(p_managed_at, '-infinity'::timestamptz\),\s*coalesce\(p_cycle_started_at, '-infinity'::timestamptz\)/);
  // Pero la espera se mide desde el último intento, aunque sea anterior.
  assert.match(calculo, /if v_has_last and \(v_last_in_cycle or not v_agenda\) then/);
  // Y quien vuelve a la cola tras hablar con un ejecutivo no se llama en el día.
  assert.match(calculo, /p_managed_at \+ make_interval\(mins => v_last_step\)/);
  // Las técnicas duplican su espera y tienen su propio tope.
  assert.match(calculo, /v_tech_minutes \* power\(2,/);
  assert.match(calculo, /hold_reason := 'tope_fallas_tecnicas'/);
  assert.match(calculo, /hold_reason := 'tope_sin_contacto'/);
});

test("por teléfono manda la espera más larga de la semana y el cupo vale por número", () => {
  const calculo = funcion(ESPERA, "dialer_compute_lead_retry");
  assert.match(calculo, /max\(attempt\.ended_at \+ make_interval/);
  assert.match(calculo, /v_phone_week\[v_max_redial\] \+ interval '7 days'/);
  assert.match(calculo, /campaign\.organization_id = p_organization_id/);
  assert.match(ESPERA, /on public\.leads \(organization_id, public\.canonical_chile_phone\(phone\)\)/);
});

test("ningún recálculo se calla ni se bloquea en cruz", () => {
  assert.match(funcion(ESPERA, "dialer_refresh_lead_retry_at"), /for update skip locked/);
  for (const nombre of ["dialer_attempt_finished_refresh", "dialer_leads_recompute_retry"]) {
    assert.match(funcion(ESPERA, nombre), /exception when others then[\s\S]*dialer_enqueue_retry_recompute/, `${nombre} debe encolar su error`);
  }
  assert.match(ESPERA, /cron\.schedule\(\s*'dialer-retry-recompute',\s*'\* \* \* \* \*'/);
  // Cambiar la política no recalcula en la misma petición.
  assert.match(funcion(ESPERA, "dialer_config_request_recompute"), /dialer_request_campaign_retry_recompute\(new\.campaign_id, false\)/);
  assert.match(funcion(ESPERA, "dialer_leads_recompute_retry"), /current_setting\('atlas\.skip_retry_recompute', true\)/);
  assert.match(ESPERA, /create trigger zz_leads_espera_de_discado\s+before insert or update of managed_at, campaign_id/);
});

test("los retenidos se ven y solo admin o el supervisor de la campaña los devuelve", () => {
  assert.match(ESPERA, /create or replace view public\.dialer_held_leads\s+with \(security_invoker = true\)/);
  const devolver = funcion(ESPERA, "dialer_release_held_leads");
  assert.match(devolver, /perform public\.assert_org_access\(v_organization_id\)/);
  assert.match(devolver, /public\.get_report_scope_campaigns\(\)/);
  assert.match(devolver, /dialer_hold_reason in \('tope_sin_contacto', 'tope_fallas_tecnicas'\)/);
});

test("la lista de no llamar: fila por llamada, alcance por cliente y consulta segura", () => {
  assert.match(NO_LLAMAR, /create unique index if not exists dialer_phone_suppressions_call_uidx\s+on public\.dialer_phone_suppressions \(source_call_id\)/);
  assert.match(NO_LLAMAR, /add column if not exists dialer_client_key text/);
  assert.match(funcion(NO_LLAMAR, "dialer_phone_suppressed_until"), /suppression\.client_key = campaign\.dialer_client_key/);
  for (const nombre of ["dialer_phone_block_reason", "dialer_lead_block_reason"]) {
    const consulta = funcion(NO_LLAMAR, nombre);
    assert.match(consulta, /security definer/);
    assert.match(consulta, /can_access_org\(/);
  }
  assert.match(NO_LLAMAR, /revoke all on function public\.dialer_phone_is_suppressed\(uuid, uuid, text\) from public, anon, authenticated;/);
  assert.match(NO_LLAMAR, /create trigger dial_attempts_block_suppressed\s+before insert on public\.dial_attempts/);
  assert.match(NO_LLAMAR, /as restrictive for all to authenticated\s+using \(organization_id = any \(public\.current_org_ids\(\)\)\)/);
  assert.doesNotMatch(NO_LLAMAR, /for delete to authenticated/);
});

test("el claim respeta horario, cortacircuitos, esperas, barrera y no llamar; la voz IA también", () => {
  const claim = funcion(CLAIM, "claim_next_dial_targets");
  assert.match(claim, /if not public\.dialer_campaign_in_calling_window\(p_campaign_id\) then\s+return;/);
  assert.match(claim, /if public\.dialer_campaign_technical_breaker_open\(p_campaign_id\) then\s+return;/);
  assert.match(claim, /if v_max_redial_attempts <= 0 then\s+return;/);
  assert.match(claim, /recent\.ended_at > now\(\) - make_interval\(mins => v_min_gap\)/);
  assert.match(claim, /not public\.dialer_phone_is_suppressed\(v_organization_id, p_campaign_id, lead\.phone\)/);
  assert.match(claim, /select distinct on \(public\.canonical_chile_phone\(lead\.phone\)\) lead\.id/);
  assert.match(funcion(CLAIM, "dialer_campaign_technical_breaker_open"), /recientes\.total >= 20/);
  assert.match(funcion(VOZ_IA, "claim_next_ai_voice_targets"), /not public\.dialer_phone_is_suppressed\(v_organization_id, p_campaign_id, lead\.phone\)/);
});

test("una llamada manual no sale hacia la lista de no llamar", () => {
  assert.match(ACCIONES, /await assertNotOnDoNotCallList\(supabase, \{ leadId \}\);\s+const \{ data, error \} = await supabase\.rpc\("begin_agent_agenda_callback"/);
  assert.match(ACCIONES, /await assertNotOnDoNotCallList\(supabase, \{ leadId \}\);\s+const \{ data, error \} = await supabase\.rpc\("begin_agent_assigned_lead_call"/);
  assert.match(ACCIONES, /if \(input\.entryMode === "before_dial"\) \{\s+await assertNotOnDoNotCallList/);
  assert.equal(dialerSuppressionMessage(null), null);
  assert.match(dialerSuppressionMessage("cliente_molesto") ?? "", /lista de no llamar \(cliente molesto\)/);
  // Cada motivo de la tabla tiene su texto.
  for (const motivo of NO_LLAMAR.match(/reason in \(([\s\S]*?)\)\)/)![1].matchAll(/'([a-z_]+)'/g)) {
    assert.ok(DIALER_SUPPRESSION_LABELS[motivo[1]], `falta el texto de ${motivo[1]}`);
  }
});

const hayPostgres =
  Boolean(process.env.DISCADOR_PG_URL) ||
  ["initdb", "pg_ctl", "psql"].every((binario) => spawnSync("sh", ["-c", `command -v ${binario}`]).status === 0);

test("escenarios SQL del discador sobre un Postgres desechable", { skip: !hayPostgres && "sin PostgreSQL local" }, () => {
  const resultado = spawnSync("bash", [fileURLToPath(new URL("../scripts/probar-discador-sql.sh", import.meta.url))], {
    encoding: "utf8",
    timeout: 180_000,
  });
  assert.equal(resultado.status, 0, `${resultado.stdout}\n${resultado.stderr}`);
  assert.match(resultado.stdout, /ESCENARIOS OK: \d+ reglas comprobadas/);
});
