// El agente que persigue el interés: lo que no puede aflojarse.
//
// Una apertura o un clic valen poco si nadie los trabaja. Este agente los
// convierte en un negocio con fecha. Si estas reglas se rompen, o duplica
// negocios, o inventa montos, o queda al alcance de cualquiera con sesión.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const MIGRACION = leer("supabase/migrations/20260917235000_agente_calificador_de_interes.sql");
const RUTA = leer("src/app/api/agentes/calificador/route.ts");
const CRONS = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
const MIDDLEWARE = leer("src/lib/supabase/middleware.ts");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("un clic entra más adelante en el embudo que una apertura", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /case when v_senal\.clicked then 'contactado' else 'prospecto' end/);
  assert.match(codigo, /order by lms\.clicked desc/);
});

test("el agente no duplica ni inventa montos", () => {
  const codigo = soloCodigo(MIGRACION);
  // Lo ya trabajado queda marcado por lead_id y no se vuelve a tomar.
  assert.match(codigo, /a\.metadata->>'lead_id' = l\.id::text/);
  // Si la empresa ya tiene negocio abierto, solo se anota la señal.
  assert.match(codigo, /where organization_id = v_org and company_id = v_company and status = 'abierta'/);
  assert.match(codigo, /v_anotados := v_anotados \+ 1;/);
  // El precio se acuerda hablando: el agente deja el monto en cero.
  assert.match(codigo, /v_stage, 0, 'agente_calificador'/);
});

test("cada negocio nace con una próxima acción con fecha", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /now\(\) \+ interval '1 day'/);
  assert.match(codigo, /next_action_note/);
  // Queda firmado como obra del agente, no de una persona.
  assert.match(codigo, /'agente', 'calificador'/);
});

test("el agente es de máquina: ninguna sesión de navegador lo alcanza", () => {
  const codigo = soloCodigo(MIGRACION);
  assert.match(codigo, /revoke execute on function public\.calificar_interes_de_correo[\s\S]*from anon, authenticated/);
  assert.match(codigo, /grant execute on function public\.calificar_interes_de_correo[\s\S]*to service_role/);
  assert.match(RUTA, /verifyIntegrationV2WorkerAuthorization/);
  assert.match(RUTA, /status: 401/);
  assert.match(MIDDLEWARE, /"\/api\/agentes\/calificador"/);
});

test("el agente corre solo, cada hora", () => {
  const cron = CRONS.crons.find((c) => c.path === "/api/agentes/calificador");
  assert.ok(cron, "el agente no está programado");
  assert.match(cron.schedule, /^\d+ \* \* \* \*$/, "debe correr cada hora");
});

test("una empresa que falla no deja sin correr a las demás", () => {
  assert.match(RUTA, /continue;/);
  assert.match(RUTA, /const EMPRESAS = \["altius"\]/);
});
