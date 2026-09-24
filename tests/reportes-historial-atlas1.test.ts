// El historial migrado de Atlas 1 no puede distorsionar la supervisión.
//
// La auditoría del encendido de Equifax encontró cuatro distorsiones: un TMO de
// ~17,7 horas por llamadas de Atlas 1 cerradas días después, 12.090 falsos
// «contacto sin llamada» en Integridad, 6.052 llamadas descartadas contadas como
// gestiones (con una tipificación «connected» que nadie eligió) y días cortados
// en UTC. Estas pruebas vigilan que las migraciones que lo corrigen no pierdan
// ni la corrección ni la frontera de empresa y de supervisor.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const migracion = (nombre: string) => leer(`supabase/migrations/${nombre}`);
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const REGLA_TMO = soloCodigo(migracion("20260924183000_reportes_regla_de_duracion_del_tmo.sql"));
const SUPERVISOR = soloCodigo(migracion("20260924183100_reporte_supervisor_sin_distorsion_de_atlas1.sql"));
const INTEGRIDAD = soloCodigo(migracion("20260924183200_integridad_no_juzga_el_historial_de_atlas1.sql"));
const GESTION = soloCodigo(migracion("20260924183300_reportes_sin_llamadas_descartadas_y_dia_en_chile.sql"));

/** Cuerpo de una función dentro de una migración, hasta su delimitador de cierre. */
function cuerpo(sql: string, funcion: string): string {
  const inicio = sql.indexOf(`create or replace function public.${funcion}(`);
  assert.ok(inicio >= 0, `falta ${funcion}`);
  const fin = sql.indexOf("$function$;", inicio);
  assert.ok(fin > inicio, `${funcion} no cierra`);
  return sql.slice(inicio, fin);
}

test("el TMO deja fuera lo migrado de Atlas 1 y las gestiones olvidadas abiertas", () => {
  assert.match(REGLA_TMO, /create or replace function public\.report_call_handle_seconds/);
  assert.match(REGLA_TMO, /when p_legacy_call_id is not null then null/);
  assert.match(REGLA_TMO, /when p_ended_at < p_started_at then null/);
  assert.match(REGLA_TMO, /p_ended_at - p_started_at > interval '2 hours' then null/);
  assert.match(REGLA_TMO, /immutable/);
  assert.match(REGLA_TMO, /revoke all on function public\.report_call_handle_seconds[^;]*from public, anon;/);
});

test("el reporte del supervisor usa la regla del TMO en vivo y en las tablas precalculadas", () => {
  const resumen = cuerpo(SUPERVISOR, "get_supervisor_report_summary");
  assert.match(resumen, /public\.report_call_handle_seconds\(c\.started_at, c\.ended_at, c\.legacy_call_id\)/);
  assert.match(resumen, /sum\(handle_seconds\) filter \(where is_call and handle_seconds is not null\)/);
  // La resta cruda de horas era la que sumaba días de Atlas 1.
  assert.doesNotMatch(resumen, /extract\(epoch from \(ended_at - started_at\)\)/);

  for (const funcion of ["refresh_supervisor_report_agent_metric_row", "refresh_supervisor_report_metric_row"]) {
    const refresco = cuerpo(SUPERVISOR, funcion);
    assert.match(refresco, /report_call_handle_seconds/, `${funcion} sin la regla del TMO`);
    assert.doesNotMatch(refresco, /extract\(epoch from \(ended_at - started_at\)\)/);
  }
});

test("una llamada descartada no suma gestiones ni una tipificación «connected»", () => {
  const resumen = cuerpo(SUPERVISOR, "get_supervisor_report_summary");
  assert.match(resumen, /where c\.discarded_reason is null/);
  // La interacción de una llamada descartada queda fuera...
  assert.match(
    resumen,
    /not exists \(\s*select 1 from public\.calls discarded\s*where discarded\.discarded_reason is not null\s*and discarded\.id::text = i\.metadata ->> 'call_id'/,
  );
  // ...y la de cualquier llamada ya no se cuenta como una segunda tipificación.
  assert.match(resumen, /i\.metadata \? 'call_id' as has_call/);
  assert.match(resumen, /from interaction_rows where not has_call/);
  // El cruce por texto necesita su índice para no recorrer calls.
  assert.match(SUPERVISOR, /create index if not exists calls_discarded_id_text_idx\s+on public\.calls \(\(id::text\)\)\s+where discarded_reason is not null;/);

  const tablero = cuerpo(GESTION, "get_crm_dashboard_summary");
  assert.equal(tablero.match(/where c\.discarded_reason is null/g)?.length, 2, "período actual y anterior");
  assert.match(cuerpo(GESTION, "get_contactability_by_hour"), /and c\.discarded_reason is null/);
  assert.match(cuerpo(GESTION, "get_campaign_tipification_breakdown"), /and c\.discarded_reason is null/);
});

test("Integridad solo juzga gestiones hechas en Atlas 2.0", () => {
  const integridad = cuerpo(INTEGRIDAD, "get_management_integrity_report");
  assert.match(integridad, /and c\.legacy_call_id is null/);
  assert.match(integridad, /and c\.discarded_reason is null/);

  const pagina = leer("src/app/dashboard/reportes/integridad/page.tsx");
  assert.match(pagina, /historial migrado de Atlas 1/);
});

test("los días se cortan en hora Chile", () => {
  const resumen = cuerpo(SUPERVISOR, "get_supervisor_report_summary");
  assert.doesNotMatch(resumen, /activity_at::date|created_at::date/);
  assert.match(resumen, /\(activity_at at time zone 'America\/Santiago'\)::date/);

  for (const funcion of ["get_call_metrics_report", "get_agent_activity_report"]) {
    const informe = cuerpo(GESTION, funcion);
    assert.match(informe, /\(p_date_from::timestamp at time zone 'America\/Santiago'\)/, funcion);
    assert.match(informe, /\(\(p_date_to \+ 1\)::timestamp at time zone 'America\/Santiago'\)/, funcion);
    assert.doesNotMatch(informe, /at time zone 'utc'/i, funcion);
    assert.doesNotMatch(informe, /v_from timestamptz := p_date_from;/, funcion);
  }
  assert.match(cuerpo(GESTION, "get_call_metrics_report"), /\(da\.originated_at at time zone 'America\/Santiago'\)::date/);

  // La ventana de la pantalla de equipo también: el servidor corre en UTC.
  const equipo = leer("src/app/dashboard/team/page.tsx");
  assert.match(equipo, /import \{[^}]*\bendOfDay\b[^}]*\} from "@\/lib\/report-range"/);
  assert.doesNotMatch(equipo, /setHours\(/);
});

test("las funciones reescritas conservan la frontera de empresa y el alcance del supervisor", () => {
  const conFrontera: [string, string][] = [
    [SUPERVISOR, "get_supervisor_report_summary"],
    [INTEGRIDAD, "get_management_integrity_report"],
    [GESTION, "get_contactability_by_hour"],
    [GESTION, "get_call_metrics_report"],
    [GESTION, "get_agent_activity_report"],
  ];
  for (const [sql, funcion] of conFrontera) {
    const definicion = cuerpo(sql, funcion);
    assert.match(definicion, /security definer/i, funcion);
    assert.match(definicion, /can_access_org/, `${funcion} perdió la frontera de empresa`);
    assert.match(definicion, /v_role/, `${funcion} no distingue admin de supervisor`);
  }

  // La empresa se resuelve una vez, no por fila de leads o llamadas.
  for (const [sql, funcion] of conFrontera.slice(0, 3)) {
    const definicion = cuerpo(sql, funcion);
    assert.match(definicion, /v_org_ids := array\(select o\.id from public\.organizations o where public\.can_access_org\(o\.id\)\)/);
    assert.match(definicion, /l\.organization_id = any\(v_org_ids\)/);
    assert.doesNotMatch(definicion, /can_access_org\(l\.organization_id\)/, funcion);
  }

  const resumen = cuerpo(SUPERVISOR, "get_supervisor_report_summary");
  assert.match(resumen, /v_team_ids := public\.supervised_team_ids\(\)/);
  assert.match(resumen, /raise exception 'No puedes consultar un equipo fuera de tu alcance\.'/);

  for (const [sql, funcion] of [
    [INTEGRIDAD, "get_management_integrity_report"],
    [GESTION, "get_contactability_by_hour"],
  ]) {
    assert.match(cuerpo(sql, funcion), /\(v_team_ids is null or l\.team_id = any\(v_team_ids\)\)/, funcion);
  }
  assert.match(cuerpo(GESTION, "get_agent_activity_report"), /\(v_team_ids is null or p\.team_id = any\(v_team_ids\)\)/);
  assert.match(cuerpo(GESTION, "get_call_metrics_report"), /v_role = 'admin' or public\.can_supervise_campaign\(camp\.id\)/);

  // La migración se comprueba a sí misma al aplicarse.
  assert.match(GESTION, /raise exception 'Informes sin filtro de empresa: %'/);
});

test("las migraciones se pueden volver a aplicar sin romper nada", () => {
  for (const sql of [REGLA_TMO, SUPERVISOR, INTEGRIDAD, GESTION]) {
    assert.doesNotMatch(sql, /\bdrop (function|table|index)\b/i);
    assert.doesNotMatch(sql, /\bcreate function\b/i);
    assert.doesNotMatch(sql, /\bcreate index (?!if not exists)/i);
    // Nada de escrituras sobre datos: solo definiciones.
    assert.doesNotMatch(sql, /^\s*(update|delete from|insert into) public\.(calls|interactions|leads)\b/im);
  }
});
