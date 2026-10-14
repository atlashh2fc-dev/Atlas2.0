// Conectar el WhatsApp del dueño de la app con un token de usuario del sistema.
//
// Nace del 14-10-2026: el registro insertado de Meta no deja que Altius Ignite
// (dueño de «Atlas CRM») se comparta su propia cuenta. Este camino evita ese
// paso, así que tiene que cuidar lo que el botón de Meta cuidaba solo: que el
// token sea de esta app, que el número esté de verdad habilitado y que nadie
// más lo use.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const REGISTRO = leer("src/lib/meta-registro.ts");
const ACCION = leer("src/app/actions/whatsapp.ts");
const PAGINA = leer("src/app/dashboard/admin/integraciones/whatsapp/page.tsx");

const cuerpoDe = (fuente: string, firma: string) => {
  const inicio = fuente.indexOf(firma);
  assert.ok(inicio >= 0, `no está ${firma}`);
  return fuente.slice(inicio, inicio + 4000);
};

test("el token tiene que ser de Atlas CRM, vigente y con los dos permisos de WhatsApp", () => {
  const validacion = cuerpoDe(REGISTRO, "export async function cuentaDelTokenDelSistema");
  assert.match(validacion, /info\.is_valid !== true/);
  assert.match(validacion, /String\(info\.app_id \?\? ""\) !== appId/);
  assert.match(validacion, /"whatsapp_business_messaging", "whatsapp_business_management"\]\.filter/);
});

test("no conecta un número que Meta no habilitó para enviar", () => {
  const validacion = cuerpoDe(REGISTRO, "export async function cuentaDelTokenDelSistema");
  assert.match(validacion, /numero\.platform_type !== "CLOUD_API"/);
  assert.match(validacion, /No se conectó nada/);
});

test("solo el dueño de la plataforma, y el guardado es el mismo que el del botón de Meta", () => {
  const accion = cuerpoDe(ACCION, "export async function conectarWhatsAppConTokenDelSistema");
  assert.match(accion, /requireProfile\(\["admin"\]\)/);
  assert.match(accion, /\(await contextoDeMiEmpresa\(\)\)\.duenio/);
  assert.match(accion, /guardarCanalDeMeta\(/);
  // El token nunca se escribe en un log.
  assert.doesNotMatch(accion, /console\.\w+\([^)]*token/);
  const guardado = cuerpoDe(ACCION, "async function guardarCanalDeMeta");
  assert.match(guardado, /Ese número ya está conectado a otra empresa/);
  assert.match(guardado, /guardar_token_de_canal_whatsapp/);
  assert.match(guardado, /suscribirApp\(wabaId, token\)/);
});

test("el campo solo aparece para el dueño y no muestra el token en pantalla", () => {
  assert.match(PAGINA, /\{duenio && \(/);
  assert.match(PAGINA, /<Input name="token" type="password" autoComplete="off"/);
});
