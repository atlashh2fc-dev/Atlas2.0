// Tope de las pausas: el teléfono avisa a la ejecutiva al pasarse y el monitor
// la resalta. La pausa no se corta a la fuerza.
//
// Medición del 25-09-2026 en Equifax: 40 % de la jornada en pausa y ningún
// motivo con tope controlado (max_seconds solo se mostraba como sugerencia).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  avisoParaEjecutiva,
  avisoParaSupervisor,
  estadoDeTope,
  formatearMinutos,
  formatearRestante,
  validarTopeEnMinutos,
} from "../src/lib/tope-de-pausa.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, "");

const MIGRACION = soloCodigo(leer("supabase/migrations/20260926140000_tope_de_pausas.sql"));
const ACCIONES = leer("src/app/actions/agent-status.ts");
const SUPERVISION = leer("src/app/actions/supervision.ts");
const ADMIN = leer("src/app/dashboard/admin/estados-agente/page.tsx");
const MENU = leer("src/components/phone/status-menu.tsx");
const TELEFONO = leer("src/components/cti-bar.tsx");
const MONITOR = leer("src/components/live-monitor.tsx");

const INICIO = "2026-09-26T13:00:00.000Z";
const t0 = new Date(INICIO).getTime();
const a = (segundos: number) => t0 + segundos * 1000;

test("dentro del tope devuelve lo que queda", () => {
  const estado = estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: true, now: a(252) });
  assert.deepEqual(estado, { tipo: "dentro", topeSegundos: 600, transcurridoSegundos: 252, restanteSegundos: 348 });
  assert.equal(formatearRestante(348), "05:48");
  assert.equal(avisoParaEjecutiva(estado), null);
  assert.equal(avisoParaSupervisor(estado), null);
});

test("justo en el tope todavía no está excedida", () => {
  const estado = estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: true, now: a(600) });
  assert.equal(estado.tipo, "dentro");
  assert.equal(estado.tipo === "dentro" && estado.restanteSegundos, 0);
});

test("al pasarse avisa con minutos de exceso y de tope", () => {
  const estado = estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: true, now: a(600 + 185) });
  assert.deepEqual(estado, { tipo: "excedida", topeSegundos: 600, transcurridoSegundos: 785, excesoSegundos: 185 });
  assert.equal(avisoParaEjecutiva(estado), "Te pasaste 4 min de tu pausa de 10 min");
  assert.equal(avisoParaSupervisor(estado), "excedida por 4 min");
});

test("un exceso de segundos se lee 1 min, no 0 min", () => {
  const estado = estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: true, now: a(601) });
  assert.equal(avisoParaEjecutiva(estado), "Te pasaste 1 min de tu pausa de 10 min");
});

test("las horas se leen como horas", () => {
  assert.equal(formatearMinutos(45 * 60), "45 min");
  assert.equal(formatearMinutos(60 * 60), "1 h");
  assert.equal(formatearMinutos(75 * 60), "1 h 15 min");
  assert.equal(formatearRestante(3725), "1:02:05");
});

test("sin tope, fuera de pausa o sin inicio no hay nada que controlar", () => {
  assert.deepEqual(estadoDeTope({ since: INICIO, maxSeconds: null, isPause: true, now: a(9999) }), { tipo: "sin_tope" });
  assert.deepEqual(estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: false, now: a(9999) }), { tipo: "sin_tope" });
  assert.deepEqual(estadoDeTope({ since: null, maxSeconds: 600, isPause: true, now: a(9999) }), { tipo: "sin_tope" });
  assert.deepEqual(estadoDeTope({ since: "no-es-fecha", maxSeconds: 600, isPause: true, now: a(9999) }), { tipo: "sin_tope" });
  assert.deepEqual(estadoDeTope({ since: INICIO, maxSeconds: 0, isPause: true, now: a(9999) }), { tipo: "sin_tope" });
});

test("un reloj del navegador atrasado no da tiempo negativo", () => {
  const estado = estadoDeTope({ since: INICIO, maxSeconds: 600, isPause: true, now: a(-30) });
  assert.deepEqual(estado, { tipo: "dentro", topeSegundos: 600, transcurridoSegundos: 0, restanteSegundos: 600 });
});

test("el tope del admin va en minutos enteros entre 1 y 480, o vacío", () => {
  assert.deepEqual(validarTopeEnMinutos("10"), { ok: true, segundos: 600 });
  assert.deepEqual(validarTopeEnMinutos(" 45 "), { ok: true, segundos: 2700 });
  assert.deepEqual(validarTopeEnMinutos(""), { ok: true, segundos: null });
  assert.deepEqual(validarTopeEnMinutos(null), { ok: true, segundos: null });
  for (const malo of ["0", "481", "-5", "10,5", "7.5", "diez", "1e2"]) {
    assert.equal(validarTopeEnMinutos(malo).ok, false, `debió rechazar ${malo}`);
  }
});

test("la migración llena topes solo donde no hay y con los minutos acordados", () => {
  assert.match(MIGRACION, /where reason\.max_seconds is null/);
  assert.match(MIGRACION, /and reason\.is_pause/);
  const esperados: Record<string, number> = {
    bano: 10, descanso: 15, almuerzo: 45, trabajo_administrativo: 10, reunion: 30,
    capacitacion: 60, retroalimentacion: 20, soporte_tecnico: 15, desconectado: 10,
  };
  for (const [codigo, minutos] of Object.entries(esperados)) {
    assert.match(MIGRACION, new RegExp(`\\('${codigo}', ${minutos}\\)`), `falta el tope de ${codigo}`);
  }
  assert.match(MIGRACION, /set max_seconds = topes\.minutos \* 60/);
  // code es único en toda la base: las empresas nuevas llevan prefijo (andes_).
  assert.match(MIGRACION, /reason\.code ~ \('\^\[a-z0-9\]\+_' \|\| topes\.code \|\| '\$'\)/);
});

test("la migración separa Correo y cotizaciones imitando a trabajo_administrativo", () => {
  assert.match(MIGRACION, /'correo_cotizaciones'/);
  assert.match(MIGRACION, /'Correo y cotizaciones'/);
  assert.match(MIGRACION, /admin\.organization_id/);
  assert.match(MIGRACION, /admin\.sort_order \+ 1/);
  assert.match(MIGRACION, /admin\.is_productive/);
  assert.match(MIGRACION, /admin\.excludes_from_adherence/);
  assert.match(MIGRACION, /10 \* 60/);
  assert.match(MIGRACION, /where admin\.code = 'trabajo_administrativo'/);
  // Idempotente: correrla dos veces no duplica ni falla.
  assert.match(MIGRACION, /on conflict \(code\) do nothing/);
  // Solo datos: no toca políticas ni funciones.
  assert.doesNotMatch(MIGRACION, /\bdrop\b|\bgrant\b|create or replace function|delete from/i);
});

test("el admin edita el tope con validación y sin fingir que guardó", () => {
  assert.match(ACCIONES, /export async function updateStatusReasonCap\(formData: FormData\)/);
  assert.match(ACCIONES, /await requireProfile\(\["admin"\]\);\n  const id = String\(formData\.get\("id"\)/);
  assert.match(ACCIONES, /validarTopeEnMinutos\(formData\.get\("max_minutes"\)\)/);
  assert.match(ACCIONES, /\.update\(\{ max_seconds: tope\.segundos \}\)/);
  assert.match(ACCIONES, /if \(!data\?\.length\) throw new Error/);
  assert.match(ADMIN, /action=\{updateStatusReasonCap\}/);
  assert.match(ADMIN, /name="max_minutes"/);
  assert.doesNotMatch(ADMIN, /Tope sugerido/);
});

test("el teléfono muestra lo que queda y avisa al pasarse sin bloquear", () => {
  assert.match(MENU, /export function PauseCap/);
  assert.match(MENU, /role="status"\s+aria-live="polite"/);
  assert.match(MENU, /avisoParaEjecutiva\(estado\)/);
  assert.match(MENU, /Quedan /);
  assert.match(TELEFONO, /pauseCapSeconds=\{pauseCapSeconds\}/);
  assert.match(TELEFONO, /currentReason\?\.is_pause \? currentReason\.max_seconds : null/);
});

test("el monitor marca a quien excede el tope de su motivo con el mismo cálculo", () => {
  assert.match(SUPERVISION, /export async function getStatusReasonCaps\(\)/);
  assert.match(SUPERVISION, /requireProfile\(\["admin", "supervisor"\]\);\n  const supabase = await createClient\(\);\n  const \{ data, error \} = await supabase\n    \.from\("agent_status_reasons"\)/);
  assert.match(MONITOR, /avisoParaSupervisor\(estado\)/);
  assert.match(MONITOR, /exceededPauses/);
  // Los topes viajan con el tablero del día (15 s), no con el sondeo de 2 s.
  const tablero = MONITOR.slice(MONITOR.indexOf("async function pollWallboard"));
  assert.match(tablero.slice(0, 1200), /getStatusReasonCaps\(\)/);
});
