// El historial migrado de Atlas 1 no puede distorsionar la supervisión.
//
// La auditoría del encendido de Equifax encontró cuatro distorsiones: un TMO de
// ~17,7 horas por llamadas de Atlas 1 cerradas días después, 12.090 falsos
// «contacto sin llamada» en Integridad, 6.052 llamadas descartadas contadas como
// gestiones (con una tipificación «connected» que nadie eligió) y días cortados
// en UTC. Estas pruebas vigilan que las migraciones que lo corrigen no pierdan
// ni la corrección ni la frontera de empresa y de supervisor.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const migracion = (nombre: string) => leer(`supabase/migrations/${nombre}`);
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const REGLA_TMO = soloCodigo(migracion("20260924183000_reportes_reglas_de_tmo_y_cotizacion.sql"));
const SUPERVISOR = soloCodigo(migracion("20260924183100_reporte_supervisor_sin_distorsion_de_atlas1.sql"));
const INTEGRIDAD = soloCodigo(migracion("20260924183200_integridad_no_juzga_el_historial_de_atlas1.sql"));
const GESTION = soloCodigo(migracion("20260924183300_reportes_sin_llamadas_descartadas_y_dia_en_chile.sql"));
const VENTAS_Y_COLA = soloCodigo(migracion("20260924183400_reportes_ventas_reales_salud_de_cola_y_tipificaciones.sql"));

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
  for (const sql of [REGLA_TMO, SUPERVISOR, INTEGRIDAD, GESTION, VENTAS_Y_COLA]) {
    assert.doesNotMatch(sql, /\bdrop (function|table|index)\b/i);
    assert.doesNotMatch(sql, /\bcreate function\b/i);
    assert.doesNotMatch(sql, /\bcreate index (?!if not exists)/i);
    // Nada de escrituras sobre datos: solo definiciones.
    assert.doesNotMatch(sql, /^\s*(update|delete from|insert into) public\.(calls|interactions|leads)\b/im);
  }
});

test("venta es lo declarado como venta y cotización el motivo exacto, en resumen, detalle y precalculados", () => {
  assert.match(REGLA_TMO, /create or replace function public\.report_call_is_quote\(p_reason text\)/);
  assert.match(REGLA_TMO, /upper\(btrim\(translate\(p_reason, 'óÓ', 'oO'\)\)\) = 'COTIZACION ENVIADA'/);
  // Sin «set search_path» Postgres incrusta las reglas en la consulta; con él,
  // la cotización costaba 3,6 s sobre las 107 mil llamadas.
  assert.doesNotMatch(REGLA_TMO, /set search_path/);

  const conVentas: [string, string][] = [
    [SUPERVISOR, "get_supervisor_report_summary"],
    [SUPERVISOR, "refresh_supervisor_report_agent_metric_row"],
    [SUPERVISOR, "refresh_supervisor_report_metric_row"],
    [VENTAS_Y_COLA, "get_supervisor_report_drilldown"],
  ];
  for (const [sql, funcion] of conVentas) {
    const definicion = cuerpo(sql, funcion);
    // «CLIENTE NO SUJETO A VENTA» contiene «VENTA»: salían 37 ventas donde había 5.
    assert.doesNotMatch(definicion, /ilike '%VENTA%'/, `${funcion} vuelve a buscar VENTA en el motivo`);
    assert.doesNotMatch(definicion, /ilike '%COTIZACION%'/, `${funcion} vuelve a buscar COTIZACION en el motivo`);
    assert.match(definicion, /report_call_is_quote\((c\.)?reason\)/, `${funcion} sin la regla de cotización`);
    assert.match(definicion, /outcome = 'sale'/, funcion);
  }
  const resumen = cuerpo(SUPERVISOR, "get_supervisor_report_summary");
  assert.match(resumen, /'llamadas_atlas1', totals\.llamadas_atlas1/);
  assert.match(leer("src/app/dashboard/reportes/page.tsx"), /kpis\.llamadas_atlas1/);
});

test("la salud de cola cuenta solo lo gestionado hoy en Atlas 2.0 y conserva su alcance", () => {
  const salud = cuerpo(VENTAS_Y_COLA, "get_queue_health");
  // Gestiones, contactos efectivos y ventas: las tres subconsultas de calls.
  assert.equal(salud.match(/and c\.discarded_reason is null\s+and c\.legacy_call_id is null/g)?.length, 3);
  assert.match(salud, /security definer/i);
  assert.match(salud, /public\.can_access_org\(public\.org_of_campaign\(dc\.campaign_id\)\)/);
  assert.match(salud, /v_team_ids := public\.supervised_team_ids\(\)/);
  assert.match(salud, /not coalesce\(public\.is_current_app_session_valid\(\), false\)/);
  assert.match(salud, /date_trunc\('day', now\(\) at time zone 'America\/Santiago'\) at time zone 'America\/Santiago'/);
});

test("las tipificaciones precalculadas cuentan cada gestión una vez", () => {
  for (const funcion of ["refresh_supervisor_report_agent_tipification_rows", "refresh_supervisor_report_tipification_rows"]) {
    const definicion = cuerpo(VENTAS_Y_COLA, funcion);
    assert.match(definicion, /and c\.discarded_reason is null/, funcion);
    // La interacción de una llamada (descartada o no) ya está en el motivo de la llamada.
    assert.match(definicion, /and not \(i\.metadata \? 'call_id'\)/, funcion);
  }
});

// Comportamiento, no solo texto: levanta un PostgreSQL local y desechable con
// una migrada de 3 días, una descartada con su interacción, una nativa de 90 s
// a las 22:30 de Chile y ventas falsas por texto (ver
// tests/fixtures/reportes-historial-atlas1*.sql). Sin PostgreSQL instalado se omite.
const faltaPostgres = ["initdb", "pg_ctl", "psql"].some(
  (programa) => spawnSync("sh", ["-c", `command -v ${programa}`]).status !== 0,
);
test("los reportes calculan bien con datos (PostgreSQL local)", { skip: faltaPostgres && "sin PostgreSQL local" }, () => {
  const guion = decodeURIComponent(new URL("../scripts/test-reportes-historial-atlas1.sh", import.meta.url).pathname);
  const corrida = spawnSync("bash", [guion], { encoding: "utf8", timeout: 120_000 });
  assert.equal(corrida.status, 0, `${corrida.stdout}\n${corrida.stderr}`);
  assert.match(corrida.stdout, /Reportes con historial de Atlas 1: OK/);
});
