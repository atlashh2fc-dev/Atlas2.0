// Las funciones SECURITY DEFINER se saltan la seguridad por fila.
//
// Son el agujero clásico de un CRM multiempresa: las políticas dicen que un
// admin de Geimser no puede ver a Altius, pero un informe que corre como dueño
// de la base responde igual. Estas pruebas vigilan que cada función expuesta a
// la aplicación tenga su frontera puesta.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migracion = (nombre: string) =>
  readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");

const AYUDANTES = migracion("20260917153000_ayudantes_de_acceso_por_organizacion.sql");
const ENVOLTURAS = migracion("20260917184356_envuelve_funciones_con_guardia_de_organizacion.sql");
const LISTAS = migracion("20260917184456_guardia_de_organizacion_en_listas_e_integracion.sql");
const CONTACTABILIDAD = migracion("20260917184530_informes_de_contactabilidad_y_flujos_por_organizacion.sql");
const OPERATIVOS = migracion("20260917184615_informes_operativos_filtran_por_organizacion.sql");
const SUPERVISION = migracion("20260917184658_informes_de_supervision_filtran_por_organizacion.sql");
const VOCALCOM = migracion("20260917184747_importacion_vocalcom_respeta_la_organizacion.sql");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Reciben el id de un dato y ahora comprueban de qué empresa es. */
const FUNCIONES_CON_ENVOLTURA = [
  "get_mail_engagement_queue", "get_mail_engagement_page", "get_mail_engagement_report",
  "get_mail_engagement_report_read_model", "get_mail_agent_control_summary",
  "get_mail_agent_control_summary_read_model", "get_mail_operational_bucket_summary",
  "get_mail_operational_queue_page", "get_contact_center_queue_control",
  "take_over_whatsapp_conversation", "enqueue_assigned_mail_reply", "set_my_active_campaign",
  "enter_agent_hybrid_manual_mode", "begin_agent_agenda_callback", "begin_agent_assigned_lead_call",
  "assign_lead", "convert_inbound_email_to_lead", "complete_my_kovacs_demo_assignment",
  "open_my_lead_orchestrator_assignment", "can_manage_campaign", "can_supervise_campaign",
  "force_agent_logout",
];

/** Reciben listas o cargan datos desde otro sistema. */
const FUNCIONES_CON_GUARDIA_DE_LISTA = [
  "release_callbacks_to_pool", "reschedule_callbacks", "assign_mail_engagement_opportunities",
  "create_manual_lead_record", "can_supervise_mail_lead", "management_requires_equifax_data",
  "lead_agenda_requirement", "has_active_dial_attempt", "upsert_external_leads",
  "apply_mail_result_batch", "map_atlas_lead_mail_campaign",
  "confirm_atlas_lead_mail_campaign_handshake",
];

/** Informes que agregan: filtran las filas, no basta con una guardia de entrada. */
const INFORMES_QUE_FILTRAN = [
  "get_contactability_by_hour", "get_workflow_compliance", "get_call_metrics_report",
  "get_agent_live_status", "get_queue_health", "get_agent_activity_report",
  "get_management_integrity_report", "get_supervisor_report_summary",
  "get_secretaria_virtual_channel_funnel",
];

test("los ayudantes de frontera existen y no quedan abiertos a visitantes", () => {
  assert.match(soloCodigo(AYUDANTES), /create or replace function public\.can_access_org/);
  assert.match(soloCodigo(AYUDANTES), /create or replace function public\.assert_org_access/);
  assert.match(soloCodigo(AYUDANTES), /revoke execute on function public\.can_access_org\(uuid\) from anon/);
  assert.match(soloCodigo(AYUDANTES), /revoke execute on function public\.assert_org_access\(uuid\) from anon/);
  // El dueño de la plataforma sigue cruzando organizaciones, a propósito.
  assert.match(soloCodigo(AYUDANTES), /public\.is_platform_owner\(\)/);
});

test("cada función que recibe un id queda envuelta por la guardia", () => {
  const codigo = soloCodigo(ENVOLTURAS);
  for (const funcion of FUNCIONES_CON_ENVOLTURA) {
    assert.match(codigo, new RegExp(`'${funcion}'`), `falta envolver ${funcion}`);
  }
  // La original deja de ser llamable desde el cliente.
  assert.match(codigo, /rename to %I/);
  assert.match(codigo, /revoke execute on function public\.%I\(%s\) from anon, authenticated/);
  assert.match(codigo, /perform public\.assert_org_access/);
});

test("las listas de leads se comprueban completas, no solo el primer elemento", () => {
  const codigo = soloCodigo(LISTAS);
  assert.match(codigo, /create or replace function public\.assert_org_access_de_leads/);
  assert.match(codigo, /from unnest\(p_lead_ids\) as id/);
  assert.match(codigo, /raise exception 'La lista incluye % dato\(s\) de otra empresa'/);
  for (const funcion of FUNCIONES_CON_GUARDIA_DE_LISTA) {
    assert.match(codigo, new RegExp(`'${funcion}'`), `falta la guardia de ${funcion}`);
  }
});

test("los informes filtran filas por empresa y lo verifican al aplicarse", () => {
  const codigo = [CONTACTABILIDAD, OPERATIVOS, SUPERVISION].map(soloCodigo).join("\n");
  for (const informe of INFORMES_QUE_FILTRAN) {
    assert.match(codigo, new RegExp(informe), `falta filtrar ${informe}`);
  }
  assert.match(codigo, /can_access_org/);
  // Las migraciones que reescriben por anclaje deben fallar si el anclaje cambió.
  assert.match(soloCodigo(OPERATIVOS), /se esperaba exactamente una/);
  assert.match(soloCodigo(SUPERVISION), /se esperaba exactamente una/);
  assert.match(soloCodigo(SUPERVISION), /raise exception 'Informes sin filtro de empresa/);
});

test("la importación de Vocalcom solo cruza leads de la empresa que carga", () => {
  const codigo = soloCodigo(VOCALCOM);
  assert.match(codigo, /from \(select \* from public\.leads where public\.can_access_org\(organization_id\)\) l/);
  assert.match(codigo, /raise exception 'import_vocalcom_events quedó sin frontera de empresa'/);
});

// Lo que costó una caída en producción, y no puede repetirse.
//
// Renombrar la función original a `*_sin_empresa` movió el objeto, no el
// nombre: las políticas que la usaban quedaron llamando a la versión sin
// guardia, a la que se le había quitado el permiso de ejecución. Cualquier
// consulta con sesión contra esas tablas respondía "permission denied" y la
// pantalla de Correo caía con error 500.

const REPARA_POLITICAS = migracion("20260917230100_las_politicas_vuelven_a_la_funcion_con_guardia.sql");
const GUARDIA_QUE_FILTRA = migracion("20260917230000_una_guardia_que_filtra_no_revienta.sql");

test("ninguna política puede quedar apuntando a la función sin guardia", () => {
  assert.match(REPARA_POLITICAS, /replace\(coalesce\(v_politica\.qual, ''\), '_sin_empresa', ''\)/);
  // La migración se comprueba a sí misma: si queda una, falla al aplicarse.
  assert.match(REPARA_POLITICAS, /if v_quedan > 0 then\s*\n\s*raise exception/);
});

test("un predicado filtra y una acción revienta", () => {
  // Cinco predicados: se usan para decidir si una fila entra en un informe.
  for (const funcion of [
    "can_manage_campaign",
    "can_supervise_campaign",
    "can_supervise_mail_lead",
    "has_active_dial_attempt",
    "management_requires_equifax_data",
  ]) {
    assert.ok(GUARDIA_QUE_FILTRA.includes(funcion), `falta ${funcion}`);
  }
  assert.match(GUARDIA_QUE_FILTRA, /if not public\.can_access_org\(\\1\) then return false; end if;/);
  // Tomar una conversación cambia el estado: ahí el error se queda.
  assert.match(GUARDIA_QUE_FILTRA, /take_over_whatsapp_conversation[\s\S]*?raise exception 'Una acción perdió su guardia dura'/);
});
