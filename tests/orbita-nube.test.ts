// Órbita en la nube: el reloj decide solo cuándo corre cada agente y a quién
// recupera. Si el horario se lee mal, el CEO decide a las 3 de la mañana o no
// decide nunca; si el Guardián se equivoca, un agente caído se queda caído o
// uno sano corre dos veces.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fechaDeChile, horaDeChile, leerCron, ultimoTurno } from "../src/lib/orbita-cron.ts";
import { decidirGuardian, MAX_INTENTOS, type AgenteParaGuardian, type EjecucionParaGuardian } from "../src/lib/orbita-guardian.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

// 4 de octubre de 2026 es domingo; Chile está en horario de verano (UTC-3).
const chile = (fecha: string) => new Date(`${fecha}-03:00`);

test("el cron se lee con listas, rangos y pasos; lo inválido no se agenda", () => {
  assert.ok(leerCron("30 8 * * *"));
  assert.ok(leerCron("0 10 * * 1,4"));
  assert.ok(leerCron("*/15 * * * *"));
  assert.ok(leerCron("0 9-18/3 * * 1-5"));
  assert.deepEqual([...leerCron("0 0 * * 7")!.semana], [0]);
  assert.equal(leerCron("30 8 * *"), null);
  assert.equal(leerCron("61 8 * * *"), null);
  assert.equal(leerCron("a b c d e"), null);
  assert.equal(leerCron(null), null);
});

test("la hora y la fecha son las de Chile", () => {
  const instante = chile("2026-10-04T08:30:00");
  assert.deepEqual(horaDeChile(instante), { anio: 2026, mes: 10, dia: 4, hora: 8, minuto: 30, semana: 0 });
  assert.equal(fechaDeChile(new Date("2026-10-05T02:00:00Z")), "2026-10-04");
});

test("el último turno es el de hoy si ya pasó, y el de ayer si todavía no", () => {
  assert.equal(ultimoTurno("30 8 * * *", chile("2026-10-04T09:10:00"))?.toISOString(), chile("2026-10-04T08:30:00").toISOString());
  assert.equal(ultimoTurno("30 8 * * *", chile("2026-10-04T08:29:00"))?.toISOString(), chile("2026-10-03T08:30:00").toISOString());
  assert.equal(ultimoTurno("30 8 * * *", chile("2026-10-04T08:29:00"), 60), null);
  // Lunes y jueves: el domingo, el último fue el jueves (fuera de 24 h).
  assert.equal(ultimoTurno("0 10 * * 1,4", chile("2026-10-04T12:00:00")), null);
  assert.equal(ultimoTurno("0 10 * * 1,4", chile("2026-10-05T10:04:00"))?.toISOString(), chile("2026-10-05T10:00:00").toISOString());
});

const agente = (codigo: string, extra: Partial<AgenteParaGuardian> = {}): AgenteParaGuardian => ({
  codigo,
  motor: null,
  activo: true,
  cron: "30 8 * * *",
  duracion_max_min: 30,
  ultimo_estado: "ok",
  ultimo_evento_at: null,
  ...extra,
});

const ejecucion = (extra: Partial<EjecucionParaGuardian>): EjecucionParaGuardian => ({
  id: "e1",
  agente_codigo: "0",
  programada_para: chile("2026-10-04T08:30:00").toISOString(),
  intento: 1,
  estado: "ok",
  iniciada_at: chile("2026-10-04T08:31:00").toISOString(),
  terminada_at: chile("2026-10-04T08:33:00").toISOString(),
  created_at: chile("2026-10-04T08:30:30").toISOString(),
  ...extra,
});

test("a un agente de la nube se le lanza su turno una sola vez", () => {
  const ceo = agente("0", { motor: "ceo" });
  const ahora = chile("2026-10-04T08:31:00");
  assert.deepEqual(decidirGuardian([ceo], [], ahora).lanzar, [{ codigo: "0", programada_para: chile("2026-10-04T08:30:00").toISOString(), intento: 1, motivo: "turno" }]);
  assert.deepEqual(decidirGuardian([ceo], [ejecucion({ estado: "corriendo", terminada_at: null })], ahora).lanzar, []);
  assert.deepEqual(decidirGuardian([ceo], [ejecucion({})], ahora).lanzar, []);
  // Pausado, sin cron o con un turno más viejo que la ventana: no se lanza.
  assert.deepEqual(decidirGuardian([{ ...ceo, activo: false }], [], ahora).lanzar, []);
  assert.deepEqual(decidirGuardian([{ ...ceo, cron: null }], [], ahora).lanzar, []);
  assert.deepEqual(decidirGuardian([ceo], [], chile("2026-10-04T23:00:00")).lanzar, []);
});

test("un turno que falló se reintenta después de esperar, hasta 3 intentos", () => {
  const ceo = agente("0", { motor: "ceo" });
  const fallo = ejecucion({ estado: "error", terminada_at: chile("2026-10-04T08:33:00").toISOString() });
  assert.deepEqual(decidirGuardian([ceo], [fallo], chile("2026-10-04T08:35:00")).lanzar, []);
  assert.deepEqual(decidirGuardian([ceo], [fallo], chile("2026-10-04T08:39:00")).lanzar, [
    { codigo: "0", programada_para: chile("2026-10-04T08:30:00").toISOString(), intento: 2, motivo: "reintento" },
  ]);
  const agotado = ejecucion({ estado: "error", intento: MAX_INTENTOS });
  const decision = decidirGuardian([ceo], [fallo, agotado], chile("2026-10-04T09:30:00"));
  assert.deepEqual(decision.lanzar, []);
  // El motor ya avisó del último fallo: el Guardián no repite el aviso.
  assert.deepEqual(decision.agotados, []);
});

test("un turno colgado o que nunca arrancó se cierra y se relanza", () => {
  const ceo = agente("0", { motor: "ceo", duracion_max_min: 20 });
  const colgada = ejecucion({ estado: "corriendo", terminada_at: null, iniciada_at: chile("2026-10-04T08:31:00").toISOString() });
  const decision = decidirGuardian([ceo], [colgada], chile("2026-10-04T08:55:00"));
  assert.equal(decision.cerrar.length, 1);
  assert.deepEqual(decision.lanzar.map((l) => [l.intento, l.motivo]), [[2, "colgada"]]);

  const perdida = ejecucion({ estado: "pendiente", iniciada_at: null, terminada_at: null, created_at: chile("2026-10-04T08:31:00").toISOString() });
  assert.deepEqual(decidirGuardian([ceo], [perdida], chile("2026-10-04T08:33:00")).lanzar, []);
  assert.deepEqual(decidirGuardian([ceo], [perdida], chile("2026-10-04T08:40:00")).lanzar.map((l) => l.motivo), ["reintento"]);

  const ultimaColgada = { ...colgada, intento: MAX_INTENTOS };
  assert.deepEqual(decidirGuardian([ceo], [ultimaColgada], chile("2026-10-04T08:55:00")).agotados.map((a) => a.codigo), ["0"]);
});

test("un agente local que no corrió a su hora queda atrasado, una vez", () => {
  const educador = agente("1", { cron: "0 9 * * *", ultimo_evento_at: chile("2026-10-03T09:05:00").toISOString() });
  assert.deepEqual(decidirGuardian([educador], [], chile("2026-10-04T09:30:00")).atrasados, []);
  assert.deepEqual(decidirGuardian([educador], [], chile("2026-10-04T09:50:00")).atrasados, [{ codigo: "1", turno: chile("2026-10-04T09:00:00").toISOString() }]);
  assert.deepEqual(decidirGuardian([{ ...educador, ultimo_estado: "atrasado" }], [], chile("2026-10-04T09:50:00")).atrasados, []);
  const corrio = { ...educador, ultimo_evento_at: chile("2026-10-04T09:07:00").toISOString() };
  assert.deepEqual(decidirGuardian([corrio], [], chile("2026-10-04T09:50:00")).atrasados, []);
  // Al Guardián (motor de la nube sin turno) no se le pide nada.
  assert.deepEqual(decidirGuardian([agente("G", { motor: "guardian", cron: "*/15 * * * *" })], [], chile("2026-10-04T09:50:00")), {
    lanzar: [],
    cerrar: [],
    agotados: [],
    atrasados: [],
    equipoLocalSinSenal: false,
  });
});

test("dos agentes locales atrasados a la vez: el equipo local parece apagado", () => {
  const ahora = chile("2026-10-04T11:50:00");
  const educador = agente("1", { cron: "0 9 * * *", ultimo_estado: "atrasado" });
  const datos = agente("2", { cron: "0 11 * * *", ultimo_evento_at: chile("2026-10-03T11:05:00").toISOString() });
  assert.equal(decidirGuardian([datos], [], ahora).equipoLocalSinSenal, false);
  assert.equal(decidirGuardian([educador, datos], [], ahora).equipoLocalSinSenal, true);
});

test("la migración de la nube es idempotente, aislada por empresa y sin acceso anónimo", () => {
  const sql = leer("supabase/migrations/20261004090000_orbita_nube.sql").replace(/--[^\n]*/g, "");
  for (const tabla of ["orbita_tareas", "orbita_notas", "orbita_ejecuciones"]) assert.match(sql, new RegExp(`create table if not exists public\\.${tabla}`));
  assert.match(sql, /add column if not exists motor text/);
  assert.match(sql, /orbita_ejecuciones_turno_uniq unique \(organization_id, agente_codigo, programada_para, intento\)/);
  assert.match(sql, /as restrictive for all to authenticated/);
  assert.match(sql, /revoke all on public\.%I from anon/);
});

test("el reloj y el ejecutor exigen CRON_SECRET; el puente exige firma", () => {
  for (const ruta of ["src/app/api/orbita/reloj/route.ts", "src/app/api/orbita/ejecutar/route.ts"]) {
    assert.match(leer(ruta), /if \(!cronAutorizado\(request\)\) return NextResponse\.json\(\{ error: "No autorizado" \}, \{ status: 401 \}\)/);
  }
  assert.match(leer("src/app/api/orbita/tareas/route.ts"), /leerEnvioFirmado\(request/);
  const vercel = JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] };
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/orbita/reloj" && cron.schedule === "*/5 * * * *"));
});
