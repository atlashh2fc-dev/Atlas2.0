// La bitácora: sin ella, un agente caído se ve igual que un día tranquilo.
//
// Todo lo que falló esta semana falló en silencio. Si mañana no llega el
// informe, esta tabla es lo único que distingue "falló el envío" de "el cron
// nunca despertó al agente".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const BITACORA = leer("supabase/migrations/20260918140237_bitacora_de_los_agentes.sql");
const CALIFICADOR = leer("src/app/api/agentes/calificador/route.ts");
const VIGILANTE = leer("src/app/api/agentes/vigilante/route.ts");

const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

test("la bitácora la escribe el servicio, nunca una sesión de navegador", () => {
  const codigo = soloCodigo(BITACORA);
  assert.match(codigo, /create table if not exists public\.agent_runs/);
  assert.match(codigo, /revoke execute on function public\.anotar_corrida_de_agente[\s\S]*from anon, authenticated/);
  assert.match(codigo, /grant execute on function public\.anotar_corrida_de_agente[\s\S]*to service_role/);
  // Y respeta la frontera de empresa como todo lo demás.
  assert.match(codigo, /as restrictive for all to authenticated/);
});

test("los dos agentes anotan cada corrida, incluso cuando fallan", () => {
  for (const [nombre, codigo] of [["calificador", CALIFICADOR], ["vigilante", VIGILANTE]] as const) {
    assert.match(codigo, /anotar_corrida_de_agente/, `${nombre} no anota su corrida`);
    assert.match(codigo, /"error"/, `${nombre} no anota sus fallas`);
  }
  // El vigilante deja constancia de si el informe salió o no.
  assert.match(VIGILANTE, /informe \$\{envio\.enviado \? "enviado" : "no enviado"\}/);
});

test("anotar no puede tumbar al agente", () => {
  // Si la bitácora falla, el trabajo ya está hecho y eso vale más que el registro.
  assert.match(CALIFICADOR, /no se pudo anotar la corrida/);
});

test("el vigilante avisa cuando otro agente deja de correr", () => {
  const codigo = soloCodigo(BITACORA);
  assert.match(codigo, /create or replace function public\.ultima_corrida_de_agente/);
  assert.match(codigo, /horas_desde/);
});
