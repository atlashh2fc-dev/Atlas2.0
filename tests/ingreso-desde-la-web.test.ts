// La web de Altius entra al embudo: lo que no puede aflojarse.
//
// Este es el único camino por el que entra un negocio sin sesión de usuario.
// Si la firma, la ventana de tiempo o el permiso de la función se relajan,
// cualquiera podría escribir en el CRM. Estas pruebas vigilan esa puerta.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer("supabase/migrations/20260917201000_ingreso_de_negocios_desde_la_web.sql");
const RUTA = leer("src/app/api/integrations/altius/intake/route.ts");
const MIDDLEWARE = leer("src/lib/supabase/middleware.ts");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("la puerta de entrada es solo para el servicio, nunca para un visitante", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /create or replace function public\.ingresar_negocio_desde_web/);
  assert.match(codigo, /security definer/);
  assert.match(codigo, /revoke execute on function public\.ingresar_negocio_desde_web[\s\S]*from anon, authenticated/);
  assert.match(codigo, /grant execute on function public\.ingresar_negocio_desde_web[\s\S]*to service_role/);
  assert.doesNotMatch(codigo, /to anon/);
});

test("la empresa llega por slug y se comprueba que exista", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /v_org uuid := public\.organization_id_by_slug\(p_organization_slug\)/);
  assert.match(codigo, /raise exception 'La empresa % no existe'/);
  // El tipo de contacto es cerrado: nada fuera de la lista entra al embudo.
  assert.match(codigo, /p_kind not in \('reunion', 'plan', 'diagnostico', 'contacto'\)/);
});

test("un reintento de la web no duplica el negocio", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /metadata->>'external_id' = p_external_id/);
  assert.match(codigo, /'duplicado', true/);
  assert.match(codigo, /create index if not exists sales_activities_external_id_idx/);
  // La empresa y el negocio abierto se reutilizan antes de crear otros.
  assert.match(codigo, /where organization_id = v_org and company_id = v_company and status = 'abierta'/);
});

test("quien agenda entra a reunión; el resto, al inicio del embudo", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /case when p_kind = 'reunion' then 'reunion' else 'contactado' end/);
  assert.match(codigo, /next_action_note/);
});

test("la ruta exige firma y marca de tiempo fresca", () => {
  assert.match(RUTA, /process\.env\.ALTIUS_INTAKE_SECRET/);
  // Sin secreto no se acepta nada: mejor que el sitio reintente.
  assert.match(RUTA, /if \(!secreto\)[\s\S]{0,120}status: 503/);
  assert.match(RUTA, /createHmac\("sha256", secreto\)\.update\(`\$\{timestamp\}\.\$\{cuerpo\}`\)/);
  assert.match(RUTA, /timingSafeEqual/);
  assert.match(RUTA, /VENTANA_SEGUNDOS = 300/);
  assert.match(RUTA, /status: 401/);
  // El cuerpo se firma crudo: parsear antes de comprobar rompería la firma.
  assert.ok(RUTA.indexOf("await request.text()") < RUTA.indexOf("JSON.parse"));
});

test("la ruta escribe con el cliente de servicio y no acepta empresa libre del cliente", () => {
  assert.match(RUTA, /createAdminClient\(\);\n\s*const \{ data, error \} = await admin\.rpc\("ingresar_negocio_desde_web"/);
  assert.match(RUTA, /p_organization_slug: texto\(datos\.empresa_crm, 40\) \?\? "altius"/);
});

test("la ruta queda fuera de la sesión web, pero solo ella", () => {
  assert.match(MIDDLEWARE, /"\/api\/integrations\/altius\/intake"/);
  assert.match(MIDDLEWARE, /MACHINE_ONLY_PATHS\.has\(request\.nextUrl\.pathname\)/);
});
