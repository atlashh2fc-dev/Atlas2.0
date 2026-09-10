// Invariantes de seguridad que ya se rompieron una vez.
//
// Cada prueba de acá corresponde a un agujero real que estuvo abierto en
// producción. No son hipótesis: son regresiones que hay que impedir.
//
// Las que se pueden comprobar contra la base se comprueban de verdad, con la
// clave anónima, que es exactamente la que tiene cualquiera que abra el sitio.
// Las que dependen de una sesión autenticada, que no se puede fabricar acá, se
// comprueban sobre el texto de la migración, igual que el resto del repositorio.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const CLAVE_ANONIMA =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const SIN_CREDENCIALES = !URL_BASE || !CLAVE_ANONIMA;
const motivoSalto = "Falta la URL o la clave anónima: no se puede probar contra la base.";

const anonimo = SIN_CREDENCIALES
  ? null
  : createClient(URL_BASE, CLAVE_ANONIMA, { auth: { persistSession: false } });

const migracion = (nombre: string) =>
  readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");

/**
 * SQL sin comentarios.
 *
 * Las migraciones explican en sus comentarios qué patrón se eliminó y por qué,
 * así que nombran justamente lo que estas pruebas verifican que no exista. Sin
 * este filtro, la documentación haría fallar la verificación.
 */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

/**
 * Tablas que nadie debe poder leer sin iniciar sesión.
 *
 * Las tres últimas se agregaron después de comprobar que sí se leían: con la
 * sola clave pública se obtenían las 19 campañas con su descripción comercial,
 * los 30 pares de ejecutivo y campaña (el organigrama, más identificadores
 * válidos de usuarios) y las 95 ramas de los guiones de venta.
 */
const TABLAS_CERRADAS = [
  "leads",
  "lead_contacts",
  "profiles",
  "calls",
  "interactions",
  "crm_entities",
  "teams",
  "campaigns",
  "campaign_agents",
  "workflow_step_branches",
];

test(
  "sin iniciar sesión no se lee ninguna tabla con datos de clientes ni de la operación",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    const filtradas: string[] = [];

    await Promise.all(
      TABLAS_CERRADAS.map(async (tabla) => {
        const { data, error } = await anonimo!.from(tabla).select("*").limit(1);
        // Da igual si responde error de permisos o cero filas: lo inaceptable
        // es que devuelva una fila.
        if (!error && (data?.length ?? 0) > 0) {
          filtradas.push(tabla);
        }
      }),
    );

    assert.deepEqual(filtradas, [], "estas tablas se leen sin iniciar sesión");
  },
);

test(
  "sin iniciar sesión no se puede escribir un perfil",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    const { data, error } = await anonimo!
      .from("profiles")
      .update({ role: "admin" })
      .neq("id", "00000000-0000-0000-0000-000000000000")
      .select("id");

    assert.ok(
      error || (data?.length ?? 0) === 0,
      "un anónimo pudo escribir en perfiles",
    );
  },
);

test("la escalada de privilegios en perfiles sigue cerrada", () => {
  // La política de actualización no tiene WITH CHECK, así que Postgres reutiliza
  // el USING para validar la fila resultante. Esa fila conserva el mismo id, o
  // sea que sigue cumpliendo "es mi propia fila" pase lo que pase con el resto
  // de las columnas. Lo único que impide hacerse admin es que el permiso de
  // escritura sobre esas columnas esté revocado.
  const sql = soloCodigo(migracion("20260911010000_block_self_privilege_escalation_on_profiles.sql"));

  assert.match(
    sql,
    /revoke\s+update\s+on\s+public\.profiles\s+from\s+authenticated,\s*anon/i,
    "hay que revocar el UPDATE de la tabla: un revoke por columna no sirve mientras exista el permiso de tabla",
  );

  const concesion = sql.match(/grant\s+update\s*\(([^)]*)\)\s*on\s+public\.profiles/i);
  assert.ok(concesion, "falta devolver el permiso de las columnas que la aplicación sí escribe");

  const columnas = concesion[1].split(",").map((c) => c.trim()).sort();
  assert.deepEqual(
    columnas,
    ["active", "intercall_break_until"],
    "sólo esas dos columnas se escriben con el cliente del usuario; rol, equipo e is_demo van por service_role",
  );
});

test("la política de leads no vuelve a llamar una función por fila", () => {
  // has_active_dial_attempt(id) aplicaba una función a la columna de cada fila.
  // Eso impedía el BitmapOr y degradaba TODAS las consultas de un agente a un
  // recorrido completo: 998 ms contra 3,9 ms.
  const sql = soloCodigo(migracion("20260911012000_index_friendly_agent_lead_visibility.sql"));

  assert.doesNotMatch(
    sql,
    /has_active_dial_attempt\s*\(\s*id\s*\)/,
    "volvió la llamada por fila que mataba los índices",
  );

  // El cast a uuid[] tampoco es cosmético: sin él, Postgres interpreta el
  // paréntesis como subconsulta de ANY y el planner vuelve al recorrido completo.
  const usos = sql.match(/id = any\(\(select public\.active_dial_attempt_lead_ids\(\)\)::uuid\[\]\)/g);
  assert.equal(
    usos?.length,
    3,
    "las tres apariciones (select, update y su check) deben usar la forma con cast",
  );
});

test("las funciones de Correo no reimplementan la regla de acceso", () => {
  // El permiso se dejó de evaluar por fila, pero la decisión la sigue tomando
  // can_supervise_mail_lead. Reimplementar la lógica en línea sería más rápido
  // todavía y es exactamente donde se filtran datos de un equipo a otro.
  const archivos = [
    "20260911001500_evaluate_mail_supervision_once_per_scope.sql",
    "20260911003000_single_pass_mail_bucket_summary.sql",
    "20260911004500_filter_mail_queue_by_scope_before_laterals.sql",
    "20260911005500_filter_mail_agent_control_by_scope.sql",
  ];

  for (const archivo of archivos) {
    const sql = soloCodigo(migracion(archivo));
    assert.match(
      sql,
      /where public\.can_supervise_mail_lead\(camp, equipo\)/,
      `${archivo}: la decisión de acceso dejó de delegarse en can_supervise_mail_lead`,
    );
    assert.match(
      sql,
      /select distinct s\.campaign_id as camp, l\.team_id as equipo/,
      `${archivo}: el permiso debe resolverse por combinación distinta de campaña y equipo`,
    );
  }
});

test("el reporte de supervisor conserva sus mensajes de negocio", () => {
  // La pantalla muestra el texto de la excepción literal al usuario. Si se
  // cambian por un error técnico, el supervisor ve un mensaje incomprensible en
  // vez de saber que le faltan equipos asignados.
  const sql = soloCodigo(migracion("20260911022000_single_pass_supervisor_report_summary.sql"));

  for (const mensaje of [
    "No autenticado.",
    "Tu supervisor no tiene equipos asignados.",
    "No puedes consultar un equipo fuera de tu alcance.",
    "No tienes permisos para ver este reporte.",
  ]) {
    assert.ok(sql.includes(mensaje), `desapareció el mensaje: ${mensaje}`);
  }

  assert.doesNotMatch(
    sql,
    /resolve_supervisor_report_agent_key\s*\(/,
    "volvió la función por fila que costaba el 77 % de los bloques",
  );
});
