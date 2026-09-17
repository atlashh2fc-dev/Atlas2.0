// Multiempresa: la frontera entre organizaciones.
//
// Atlas 2.0 nació con un solo cliente y sus políticas dicen "admin => true".
// Estas pruebas vigilan que la frontera exista, que nadie quede fuera de su
// propia empresa y que la única puerta que cruza organizaciones siga siendo la
// cuenta dueña de la plataforma.
//
// Se comprueban sobre el texto de las migraciones, como el resto del
// repositorio: una sesión autenticada de otra empresa no se puede fabricar acá.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const migracion = (nombre: string) =>
  readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");

const BASE = migracion("20260917152300_organizaciones_base.sql");
const RAIZ = migracion("20260917152400_organizacion_en_tablas_raiz.sql");
const AISLAMIENTO = migracion("20260917152500_aislamiento_por_organizacion.sql");

/** SQL sin comentarios: los comentarios nombran justo lo que se verifica. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const TABLAS_RAIZ = [
  "profiles",
  "teams",
  "campaigns",
  "workflows",
  "leads",
  "crm_entities",
  "contact_center_queues",
  "whatsapp_channels",
  "historical_agents",
  "agent_status_reasons",
  "integration_sources",
  "vocalcom_import_batches",
  "staging_carga_tipificaciones",
  "staging_historial_gestiones",
  "staging_snapshots_equifax",
];

/** Tablas operativas que heredan la empresa por su relación. */
const TABLAS_HEREDADAS = [
  "ai_loop_runs", "call_events", "call_recordings", "calls", "crm_audit_events", "dial_attempts",
  "external_lead_events", "inbound_emails", "interactions", "lead_assignments", "lead_contacts",
  "lead_external_refs", "lead_mail_messages", "lead_mail_status", "lead_orchestrator_assignments",
  "mail_campaign_base_recipients", "mail_campaign_lead_status", "mail_reply_commands",
  "mail_result_contacts", "prever_survey_results", "vocalcom_call_events", "whatsapp_conversations",
  "agent_active_campaigns", "agent_hybrid_manual_requests", "ai_loop_campaign_configs",
  "ai_voice_campaign_configs", "ai_voice_test_calls", "campaign_agents", "campaign_channels",
  "contact_center_queue_sources", "dialer_agent_sessions", "dialer_agent_sessions_history",
  "dialer_campaign_configs", "external_import_batches", "inbound_mailboxes",
  "integration_campaign_mappings", "integration_inbox_batches", "lead_orchestrator_configs",
  "lead_priority_rules", "lead_uploads", "mail_campaign_bases", "mail_campaigns",
  "mail_result_batches", "whatsapp_ai_configs", "whatsapp_automation_changes",
  "whatsapp_campaign_routes", "whatsapp_closure_reasons", "whatsapp_ai_runs",
  "whatsapp_conversation_events", "whatsapp_conversation_memories",
  "whatsapp_conversation_memory_sources", "whatsapp_media_uploads", "whatsapp_messages",
  "agent_current_status", "agent_current_status_history", "agent_sip_credentials",
  "agent_sip_provisioning_status", "contact_center_queue_members", "revoked_app_sessions",
  "user_saved_views", "user_view_preferences", "agent_control_commands", "sensitive_access_log",
  "supervisor_report_daily_agent_metrics", "supervisor_report_daily_agent_tipifications",
  "supervisor_report_daily_metrics", "supervisor_report_daily_tipifications", "team_supervisors",
  "workflow_steps", "workflow_step_branches", "legacy_tipificacion_map", "call_transcriptions",
  "call_quality_evaluations", "call_recording_access_logs", "ai_loop_feedback", "ai_loop_memory",
  "campaign_agent_schedules",
];

/** Técnicas y compartidas: se aíslan cuando Altius mueva eventos propios. */
const TABLAS_TECNICAS_PENDIENTES = [
  "integration_inbox_items",
  "integration_outbox_events",
  "integration_dead_letters",
  "integration_entity_versions",
  "integration_circuit_states",
  "integration_canary_runs",
  "integration_feedback_checkpoints",
  "whatsapp_webhook_events",
  "dialer_operational_health",
];

test("la base crea organizaciones, membresías y dueños de plataforma", () => {
  for (const tabla of ["organizations", "organization_members", "platform_owners"]) {
    assert.match(
      soloCodigo(BASE),
      new RegExp(`create table if not exists public\\.${tabla}`),
      `falta la tabla ${tabla}`,
    );
  }
  assert.match(soloCodigo(BASE), /alter table public\.organizations enable row level security/);
  assert.match(soloCodigo(BASE), /alter table public\.organization_members enable row level security/);
  assert.match(soloCodigo(BASE), /alter table public\.platform_owners enable row level security/);
});

test("Geimser y Altius nacen sembradas y toda la gente actual entra a Geimser", () => {
  assert.match(soloCodigo(BASE), /\('geimser', 'Geimser'\)/);
  assert.match(soloCodigo(BASE), /\('altius', 'Altius Ignite'\)/);
  assert.match(
    soloCodigo(BASE),
    /insert into public\.organization_members[\s\S]*from public\.profiles profile/,
    "los perfiles existentes deben quedar como miembros de Geimser",
  );
});

test("el dueño de la plataforma se identifica por su correo, no por su rol", () => {
  assert.match(soloCodigo(BASE), /lower\(account\.email\) = 'hh2fc24@gmail\.com'/);
  assert.match(
    soloCodigo(BASE),
    /create or replace function public\.is_platform_owner\(\)[\s\S]*from public\.platform_owners/,
  );
  assert.doesNotMatch(
    soloCodigo(BASE),
    /create policy platform_owners_(insert|update|delete|write)/,
    "la lista de dueños se administra por migración, nunca desde la aplicación",
  );
});

test("las tablas raíz reciben organization_id obligatorio y con Geimser por defecto", () => {
  for (const tabla of TABLAS_RAIZ) {
    assert.match(soloCodigo(RAIZ), new RegExp(`'${tabla}'`), `falta la tabla raíz ${tabla}`);
  }
  assert.match(soloCodigo(RAIZ), /add column if not exists organization_id uuid references public\.organizations\(id\)/);
  assert.match(soloCodigo(RAIZ), /alter column organization_id set default public\.default_organization_id\(\)/);
  assert.match(soloCodigo(RAIZ), /alter column organization_id set not null/);
  assert.match(soloCodigo(RAIZ), /create index if not exists/);
});

test("cada tabla operativa queda con su política restrictiva de organización", () => {
  const codigo = soloCodigo(AISLAMIENTO);
  for (const tabla of [...TABLAS_RAIZ, ...TABLAS_HEREDADAS]) {
    assert.match(
      codigo,
      new RegExp(`create policy ${tabla}_organization_isolation\\non public\\.${tabla}\\nas restrictive`),
      `la tabla ${tabla} no tiene política restrictiva de organización`,
    );
  }
});

test("la política restrictiva siempre deja pasar al dueño de la plataforma y a nadie más de otra empresa", () => {
  const politicas = soloCodigo(AISLAMIENTO).split("create policy ").slice(1);
  assert.ok(politicas.length >= 90, "se esperaban al menos 90 políticas de aislamiento");
  for (const politica of politicas) {
    const nombre = politica.slice(0, politica.indexOf("\n"));
    assert.match(politica, /public\.is_platform_owner\(\)/, `${nombre} no contempla al dueño de la plataforma`);
    assert.match(politica, /public\.current_org_ids\(\)/, `${nombre} no compara contra las empresas del visitante`);
    assert.match(politica, /with check \(/, `${nombre} no protege la escritura`);
  }
});

test("las funciones que resuelven la empresa son SECURITY DEFINER con search_path fijo", () => {
  const codigo = soloCodigo(AISLAMIENTO) + soloCodigo(BASE);
  const funciones = [...codigo.matchAll(/create or replace function (public\.[a-z_]+)\(/g)].map((m) => m[1]);
  assert.ok(funciones.includes("public.org_of_lead"), "falta org_of_lead");
  assert.ok(funciones.includes("public.current_org_ids"), "falta current_org_ids");
  const bloques = codigo.split("create or replace function ").slice(1);
  for (const bloque of bloques) {
    const nombre = bloque.slice(0, bloque.indexOf("("));
    if (!nombre.startsWith("public.org_of_") && !["public.is_platform_owner", "public.current_org_ids", "public.current_org_id", "public.default_organization_id", "public.organization_id_by_slug"].includes(nombre)) {
      continue;
    }
    assert.match(bloque, /security definer/, `${nombre} debe ser SECURITY DEFINER`);
    assert.match(bloque, /set search_path to/, `${nombre} debe fijar search_path`);
  }
});

test("las tablas técnicas que quedan compartidas están declaradas en la migración", () => {
  for (const tabla of TABLAS_TECNICAS_PENDIENTES) {
    assert.match(
      AISLAMIENTO,
      new RegExp(`\`${tabla}\``),
      `la tabla técnica ${tabla} debe quedar documentada como pendiente`,
    );
    assert.doesNotMatch(
      soloCodigo(AISLAMIENTO),
      new RegExp(`create policy ${tabla}_organization_isolation`),
      `${tabla} no debería tener política de organización todavía`,
    );
  }
});

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const CLAVE_ANONIMA =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const SIN_CREDENCIALES = !URL_BASE || !CLAVE_ANONIMA;

test(
  "sin sesión no se pueden leer las organizaciones ni sus miembros",
  { skip: SIN_CREDENCIALES ? "Falta la URL o la clave anónima." : false },
  async () => {
    const anonimo = createClient(URL_BASE, CLAVE_ANONIMA, { auth: { persistSession: false } });
    for (const tabla of ["organizations", "organization_members", "platform_owners"]) {
      const { data, error } = await anonimo.from(tabla).select("*").limit(1);
      assert.ok(error || (data?.length ?? 0) === 0, `${tabla} quedó legible sin sesión`);
    }
  },
);
