// El vigilante: lo que no puede aflojarse.
//
// Este agente existe porque los dos fallos de esta semana no gritaron: la
// campaña enviaba cero correos diciendo "éxito" y el buzón reportaba verde sin
// credenciales. Si estas reglas se rompen, volvemos a no enterarnos.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer("supabase/migrations/20260918135039_agente_vigilante_de_procesos.sql");
const RUTA = leer("src/app/api/agentes/vigilante/route.ts");
const CRONS = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
const MIDDLEWARE = leer("src/lib/supabase/middleware.ts");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("vigila los silencios que ya nos costaron caro", () => {
  const codigo = soloCodigo(MIGRACION);
  // Campaña activa que no entrega: el fallo del 18 de septiembre.
  assert.match(codigo, /Envíos de correo/);
  assert.match(codigo, /nadie recibió correo en 24 horas/);
  // Interés que nadie trabaja: el calificador caído.
  assert.match(codigo, /Interés convertido en negocio/);
  // Frontera de empresa rota: los 40 leads marcados como Geimser.
  assert.match(codigo, /l\.organization_id is distinct from c\.organization_id/);
  // Políticas apuntando a la función sin permiso: el error 500 de Correo.
  assert.match(codigo, /_sin\\_empresa/);
});

test("el informe llega todos los días, esté bien o mal", () => {
  const cron = CRONS.crons.find((c) => c.path === "/api/agentes/vigilante");
  assert.ok(cron, "el vigilante no está programado");
  assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/, "debe correr todos los días, no solo hábiles");
  // Un informe que solo llega cuando algo falla enseña a ignorar la bandeja.
  assert.match(RUTA, /todo en orden/);
  assert.match(RUTA, /alerta\(s\) que revisar/);
});

test("que el vigilante falle también se avisa", () => {
  assert.match(RUTA, /el vigilante no pudo revisar/);
});

test("el informe va al dueño de la plataforma, no a una dirección escrita a mano", () => {
  assert.match(RUTA, /from\("platform_owners"\)/);
  assert.match(RUTA, /REPORTE_TO_EMAIL/);
});

test("el vigilante es de máquina y no pasa por la sesión del navegador", () => {
  assert.match(RUTA, /verifyIntegrationV2WorkerAuthorization/);
  assert.match(RUTA, /status: 401/);
  assert.match(MIDDLEWARE, /"\/api\/agentes\/vigilante"/);
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /revoke execute on function public\.verificar_procesos_de_empresa\(text\) from anon/);
});
