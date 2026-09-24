// Discador del pool: horario por campaña, esperas por lead y por teléfono,
// tope de intentos y lista de no llamar.
//
// La auditoría del 24-09-2026 encontró que el progresivo volvía a marcar al
// mismo cliente en segundos (9 llamadas en 2,5 minutos en Secretaria Virtual)
// porque 'completed' sin contestar, 'abandoned' y el descarte técnico no
// contaban como intento; que discaba a cualquier hora; y que no había lista de
// no llamar. Estas pruebas vigilan que las reglas sigan escritas.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (nombre: string) =>
  readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");

const POLITICA = leer("20260924181000_discador_horario_y_politica_de_reintentos.sql");
const NO_LLAMAR = leer("20260924181100_lista_no_llamar.sql");
const ESPERA = leer("20260924181200_espera_por_lead_y_por_telefono.sql");
const CLAIM = leer("20260924181300_claim_respeta_horario_esperas_y_no_llamar.sql");

const funcion = (sql: string, nombre: string) => {
  const inicio = sql.indexOf(`create or replace function public.${nombre}(`);
  assert.notEqual(inicio, -1, `falta ${nombre}`);
  const fin = sql.indexOf("$$;", inicio);
  return sql.slice(inicio, fin === -1 ? sql.indexOf("$function$;", inicio) : fin);
};

const TERMINALES = /'no_answer', 'busy', 'failed', 'voicemail', 'abandoned', 'completed'/;

test("la franja es por campaña, en hora Chile, y sin configurar no cambia a nadie", () => {
  assert.match(POLITICA, /add column if not exists calling_days smallint\[\],/);
  assert.match(POLITICA, /add column if not exists calling_start_time time,/);
  assert.match(POLITICA, /add column if not exists calling_end_time time,/);
  const franja = funcion(POLITICA, "dialer_calling_window_open");
  assert.match(franja, /extract\(isodow from \(p_at at time zone 'America\/Santiago'\)\)/);
  assert.match(franja, /::time >= p_start/);
  assert.match(franja, /::time < p_end/);
  // Sin fila de configuración o sin franja: se puede discar, como hasta hoy.
  assert.match(funcion(POLITICA, "dialer_campaign_in_calling_window"), /coalesce\([\s\S]*,\s*true\s*\)/);
  // No es SECURITY DEFINER: desde la pantalla manda la seguridad por fila.
  assert.doesNotMatch(funcion(POLITICA, "dialer_campaign_in_calling_window"), /security definer/);
});

test("Equifax queda de lunes a viernes de 09:00 a 19:00 sin tocar el encendido", () => {
  const equifax = POLITICA.slice(POLITICA.indexOf("update public.dialer_campaign_configs"));
  assert.match(equifax, /calling_days = '\{1,2,3,4,5\}'/);
  assert.match(equifax, /calling_start_time = '09:00'/);
  assert.match(equifax, /calling_end_time = '19:00'/);
  assert.match(equifax, /where campaign_id = '318cf37a-da42-4cbd-934d-bdc47753d7bd'/);
  assert.doesNotMatch(POLITICA, /is_active\s*=/);
});

test("la espera es escalonada y el último escalón aplica tras un contacto o un abandono", () => {
  assert.match(POLITICA, /redial_backoff_minutes integer\[\] not null default '\{30,120,1440\}'/);
  assert.match(POLITICA, /max_uncontacted_attempts integer default 8/);
  const escalon = funcion(POLITICA, "dialer_backoff_minutes");
  assert.match(escalon, /when p_long then p_ladder\[cardinality\(p_ladder\)\]/);
  assert.match(escalon, /least\(greatest\(coalesce\(p_attempts, 1\), 1\), cardinality\(p_ladder\)\)/);
});

test("todo intento terminado cuenta, incluido 'completed' sin contestar, el abandono y el descarte", () => {
  const calculo = funcion(ESPERA, "dialer_compute_lead_retry_at");
  assert.match(calculo, TERMINALES);
  // Solo lo que se tipificó durante la llamada (puente antes de la gestión) es contacto.
  assert.match(calculo, /not \(attempt\.bridged_at is not null and attempt\.bridged_at <= v_cycle_start\)/);
  // Una gestión humana abre ciclo nuevo.
  assert.match(calculo, /v_cycle_start timestamptz := coalesce\(p_managed_at, '-infinity'::timestamptz\)/);
  // Abandono: el cliente contestó y no había ejecutivo.
  assert.match(calculo, /attempt\.status = 'abandoned' or \(attempt\.answered_at is not null and attempt\.bridged_at is null\)/);
  // Tope total y ventana de 7 días.
  assert.match(calculo, /v_count >= v_cap then\s+return 'infinity'::timestamptz/);
  assert.match(calculo, /v_week_ends\[v_max_redial\] \+ interval '7 days'/);
});

test("la espera también vale para el mismo teléfono en otro lead de la empresa", () => {
  const calculo = funcion(ESPERA, "dialer_compute_lead_retry_at");
  assert.match(calculo, /public\.canonical_chile_phone\(attempt\.phone\) = v_phone/);
  assert.match(calculo, /attempt\.lead_id <> p_lead_id/);
  assert.match(calculo, /campaign\.organization_id = p_organization_id/);
  const refresco = funcion(ESPERA, "dialer_refresh_retry_at");
  assert.match(refresco, /lead\.organization_id = p_organization_id/);
  assert.match(refresco, /public\.canonical_chile_phone\(lead\.phone\) = v_phone/);
  assert.match(ESPERA, /on public\.leads \(organization_id, public\.canonical_chile_phone\(phone\)\)/);
});

test("los disparadores recalculan sin poder tumbar el registro del intento ni la ficha", () => {
  assert.match(ESPERA, /after update of status on public\.dial_attempts[\s\S]*old\.status is distinct from new\.status/);
  for (const nombre of ["dialer_attempt_finished_refresh", "dialer_leads_recompute_retry_at", "dialer_suppression_refresh_leads"]) {
    assert.match(funcion(ESPERA, nombre), /exception when others then\s+raise warning/, `${nombre} debe tragar su error`);
  }
  // Corre después de los BEFORE que fijan empresa y campaña.
  assert.match(ESPERA, /create trigger zz_leads_espera_de_discado\s+before insert or update of managed_at, campaign_id/);
});

test("la lista de no llamar se alimenta de los motivos sensibles, anclados al inicio", () => {
  const motivo = funcion(NO_LLAMAR, "dialer_suppression_reason");
  for (const patron of [
    "'^CLIENTE MOLESTO'",
    "'^(NUMERO ERRONEO|NO CORRESPONDE)'",
    "'^((TELEFONO|NUMERO) )?FUERA DE SERVICIO'",
    "'^((CLIENTE|CTE) )?CARTERIZADO'",
    "'^SE DECLARA EN QUIEBRA'",
    "'^CLIENTE NO SUJETO A VENTA'",
  ]) {
    assert.ok(motivo.includes(patron), `falta el motivo ${patron}`);
  }
  // Carterizado y no sujeto a venta son de la campaña; el resto, de la empresa.
  assert.match(funcion(NO_LLAMAR, "dialer_suppression_is_campaign_scoped"), /'cliente_carterizado', 'no_sujeto_a_venta'/);
  assert.match(NO_LLAMAR, /create trigger calls_suppress_sensitive_phone\s+after insert or update of reason, status, ended_at, discarded_reason on public\.calls/);
  // Corregir la tipificación levanta la fila; nunca bloquea el cierre.
  const disparador = funcion(NO_LLAMAR, "dialer_suppress_phone_from_call");
  assert.match(disparador, /lifted_reason = 'Se corrigió la tipificación de la llamada'/);
  assert.match(disparador, /exception when others then\s+raise warning/);
});

test("la lista respeta la frontera de empresa y no se borra desde la aplicación", () => {
  assert.match(NO_LLAMAR, /as restrictive for all to authenticated\s+using \(organization_id = any \(public\.current_org_ids\(\)\)\)/);
  assert.match(NO_LLAMAR, /array\['admin'::public\.app_role, 'supervisor'::public\.app_role\]/);
  assert.doesNotMatch(NO_LLAMAR, /for delete to authenticated/);
  assert.match(NO_LLAMAR, /revoke all on table public\.dialer_phone_suppressions from anon/);
  assert.match(funcion(NO_LLAMAR, "dialer_phone_suppressions_normalize"), /La campaña pertenece a otra empresa/);
  assert.match(NO_LLAMAR, /create unique index if not exists dialer_phone_suppressions_active_uidx/);
});

test("el claim respeta horario, esperas y no llamar, y lee la cola por índices", () => {
  const claim = funcion(CLAIM, "claim_next_dial_targets");
  assert.match(claim, /if not public\.dialer_campaign_in_calling_window\(p_campaign_id\) then\s+return;/);
  assert.match(claim, /if v_max_redial_attempts <= 0 then\s+return;/);
  assert.match(claim, /lead\.dialer_retry_at is null/);
  assert.match(claim, /lead\.dialer_retry_at <= now\(\)/);
  assert.match(claim, /not public\.dialer_phone_is_suppressed\(v_organization_id, p_campaign_id, lead\.phone\)/);
  // Un lead por teléfono en el lote.
  assert.match(claim, /select distinct on \(public\.canonical_chile_phone\(lead\.phone\)\) lead\.id/);
  // Ya no recorre ni reordena la campaña completa en cada ciclo.
  assert.doesNotMatch(claim, /recent_negative/);
  assert.match(ESPERA, /create index if not exists leads_dialer_fresh_queue_idx\s+on public\.leads \(campaign_id, external_priority_rank, updated_at\)/);
  assert.match(CLAIM, /revoke all on function public\.claim_next_dial_targets\(uuid, integer\)\s+from public, anon, authenticated;/);
});

test("las funciones con privilegios de dueño quedan cerradas a usuarios y visitantes", () => {
  for (const firma of [
    "dialer_compute_lead_retry_at(uuid, uuid, uuid, text, timestamptz)",
    "dialer_refresh_retry_at(uuid, text, uuid)",
    "dialer_attempt_finished_refresh()",
    "dialer_leads_recompute_retry_at()",
    "dialer_suppression_refresh_leads()",
  ]) {
    assert.ok(
      ESPERA.includes(`revoke all on function public.${firma} from public, anon, authenticated;`),
      `falta cerrar ${firma}`
    );
  }
  for (const firma of ["dialer_phone_suppressions_normalize()", "dialer_suppress_phone_from_call()"]) {
    assert.ok(NO_LLAMAR.includes(`revoke all on function public.${firma} from public, anon, authenticated;`), `falta cerrar ${firma}`);
  }
});
