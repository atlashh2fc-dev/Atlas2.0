// Cierre automático de conexiones cortas (20260926150000).
//
// El 25-09-2026 en Equifax el 31 % de las conexiones del discador duró menos
// de 10 s y cada una se tipificaba a mano. La regla pura vive en
// src/lib/short-call-closure.ts; la ficha la usa para armar sola el motivo por
// el camino de la tipificación anticipada. Estas pruebas cubren la regla y
// vigilan que las piezas (migración, ficha, acción, administrador) sigan en su
// lugar sin necesitar base. El SQL se prueba además en
// tests/sql/discador/escenarios.sql.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCallReasonCatalogFromWorkflow } from "../src/lib/call-typification.ts";
import {
  SHORT_CALL_AUTO_CLOSED_EVENT,
  canAutoCloseWith,
  decideShortCallClosure,
  formatShortCallSeconds,
  isShortConnection,
  measureShortCall,
  parseShortCallSettings,
  readShortCallConfig,
  shortCallClosureQualifies,
  shortCallDispositionOptions,
  shortCallNotice,
  type ShortCallFacts,
} from "../src/lib/short-call-closure.ts";
import type { WorkflowStep, WorkflowStepBranch } from "../src/lib/types.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const sinComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

// El árbol de Equifax tal como está en producción (workflow c62a0bf7…).
function paso(id: string, name: string, options: string[], isStart = false): WorkflowStep {
  return {
    id,
    workflow_id: "equifax",
    step_order: 0,
    name,
    description: null,
    is_mandatory: true,
    allowed_results: options,
    field_type: "select",
    options,
    pos_x: 0,
    pos_y: 0,
    is_start: isStart,
    created_at: "2026-09-26T00:00:00.000Z",
  } as unknown as WorkflowStep;
}
function rama(from: string, option: string, to: string): WorkflowStepBranch {
  return { id: `${from}-${option}`, workflow_id: "equifax", from_step_id: from, from_option: option, to_step_id: to, created_at: "" };
}
const CATALOGO = buildCallReasonCatalogFromWorkflow(
  [
    paso("estado", "Estado de la llamada", ["CONTACTO", "NO CONTACTO"], true),
    paso("no-contacto", "Motivo de no contacto", ["NO CONECTA", "NO CONTESTA", "BUZON DE VOZ", "TELEFONO FUERA DE SERVICIO"]),
    paso("resultado", "Resultado de la gestión", ["INTERESADO", "NO INTERESADO"]),
    paso("interesado", "Motivo interesado", ["VOLVER A LLAMAR", "SE ENVIA INFORMACION", "COTIZACION ENVIADA", "VENTA EN VALIDACION"]),
    paso("no-interesado", "Motivo no interesado", ["NO CALIFICA", "NO ES EL MOMENTO"]),
    paso("datos", "Datos comerciales Equifax", []),
  ],
  [
    rama("estado", "CONTACTO", "resultado"),
    rama("estado", "NO CONTACTO", "no-contacto"),
    rama("resultado", "INTERESADO", "interesado"),
    rama("resultado", "NO INTERESADO", "no-interesado"),
  ]
);

const corta = (talkSeconds: number, disposition = "NO CONTESTA"): ShortCallFacts => ({
  state: "ended",
  talkSeconds,
  thresholdSeconds: 10,
  disposition,
  dialAttemptId: "intento-1",
});

test("config: cualquiera de los dos campos en null deja el cierre apagado", () => {
  assert.equal(readShortCallConfig(null), null);
  assert.equal(readShortCallConfig({ short_call_seconds: null, short_call_disposition: "NO CONTESTA" }), null);
  assert.equal(readShortCallConfig({ short_call_seconds: 10, short_call_disposition: null }), null);
  assert.equal(readShortCallConfig({ short_call_seconds: 10, short_call_disposition: "  " }), null);
  assert.equal(readShortCallConfig({ short_call_seconds: 0, short_call_disposition: "NO CONTESTA" }), null);
  assert.deepEqual(readShortCallConfig({ short_call_seconds: 10, short_call_disposition: " NO CONTESTA " }), {
    thresholdSeconds: 10,
    disposition: "NO CONTESTA",
  });
});

test("medición: bridged_at -> ended_at, solo del pool y solo con la conexión terminada", () => {
  const config = { thresholdSeconds: 10, disposition: "NO CONTESTA" };
  const intento = {
    id: "intento-1",
    attempt_kind: "pool",
    bridged_at: "2026-09-25T14:00:00.000Z",
    ended_at: "2026-09-25T14:00:04.600Z",
  };
  assert.deepEqual(measureShortCall(config, intento), {
    state: "ended",
    talkSeconds: 4.6,
    thresholdSeconds: 10,
    disposition: "NO CONTESTA",
    dialAttemptId: "intento-1",
  });
  assert.deepEqual(measureShortCall(config, { ...intento, ended_at: null }), { state: "live" });
  assert.deepEqual(measureShortCall(null, intento), { state: "off" }, "campaña apagada");
  assert.deepEqual(measureShortCall(config, null), { state: "off" }, "llamada manual: sin intento del discador");
  assert.deepEqual(measureShortCall(config, { ...intento, attempt_kind: "personal_callback" }), { state: "off" }, "agenda personal decide el ejecutivo");
  assert.deepEqual(measureShortCall(config, { ...intento, bridged_at: null }), { state: "off" });
});

test("corta o no: estrictamente bajo el umbral", () => {
  assert.equal(isShortConnection(9.99, 10), true);
  assert.equal(isShortConnection(10, 10), false);
  assert.equal(isShortConnection(45, 10), false);
  assert.equal(formatShortCallSeconds(9.6), 9, "se muestra como se compara");
  assert.equal(shortCallNotice(4.2, "Buzón de voz"), "Conexión de 4 s: se cerrará como Buzón de voz");
});

test("decide: arma el motivo corto solo si la ejecutiva no armó ni eligió nada", () => {
  const base = { facts: corta(4), catalog: CATALOGO, armed: false, selectedReason: null };
  const decision = decideShortCallClosure(base);
  assert.equal(decision?.option.value, "NO CONTESTA");
  assert.equal(decision?.option.status, "no_answer");
  assert.equal(decision?.talkSeconds, 4);

  assert.equal(decideShortCallClosure({ ...base, armed: true }), null, "lo armado manda");
  assert.equal(decideShortCallClosure({ ...base, selectedReason: "VOLVER A LLAMAR" }), null, "lo elegido manda");
  assert.equal(decideShortCallClosure({ ...base, facts: corta(12) }), null, "conexión larga");
  assert.equal(decideShortCallClosure({ ...base, facts: { state: "off" } }), null, "apagado");
  assert.equal(decideShortCallClosure({ ...base, facts: { state: "live" } }), null, "llamada viva");
  assert.equal(decideShortCallClosure({ ...base, facts: corta(4, "NO EXISTE") }), null, "motivo fuera del flujo");
  assert.equal(decideShortCallClosure({ ...base, facts: corta(4, "VOLVER A LLAMAR") }), null, "motivo que pide agenda");
  assert.equal(decideShortCallClosure({ ...base, facts: corta(4, "VENTA EN VALIDACION") }), null, "venta nunca");
});

test("elegibles: sin agenda, sin datos Equifax, sin nota obligatoria ni venta", () => {
  const valores = shortCallDispositionOptions(CATALOGO).map((option) => option.value);
  assert.deepEqual(valores, ["NO CALIFICA", "NO CONECTA", "NO CONTESTA", "BUZON DE VOZ", "TELEFONO FUERA DE SERVICIO"]);
  for (const excluido of ["VOLVER A LLAMAR", "SE ENVIA INFORMACION", "COTIZACION ENVIADA", "VENTA EN VALIDACION", "NO ES EL MOMENTO"]) {
    const option = CATALOGO.find((candidate) => candidate.value === excluido);
    assert.ok(option, excluido);
    assert.equal(canAutoCloseWith(option), false, excluido);
  }
});

test("el servidor marca solo lo que vuelve a medir como corto y con el motivo configurado", () => {
  assert.equal(shortCallClosureQualifies(corta(4), "NO CONTESTA"), true);
  assert.equal(shortCallClosureQualifies(corta(4), "BUZON DE VOZ"), false, "la ejecutiva lo cambió");
  assert.equal(shortCallClosureQualifies(corta(15), "NO CONTESTA"), false);
  assert.equal(shortCallClosureQualifies({ state: "live" }, "NO CONTESTA"), false);
});

test("administrador: vacío apaga, umbral sin motivo no, motivo del catálogo sí", () => {
  assert.deepEqual(parseShortCallSettings("", "", CATALOGO), { short_call_seconds: null, short_call_disposition: null });
  assert.deepEqual(parseShortCallSettings("10", "NO CONTESTA", CATALOGO), { short_call_seconds: 10, short_call_disposition: "NO CONTESTA" });
  assert.throws(() => parseShortCallSettings("10", "", CATALOGO), /Elige el motivo/);
  assert.throws(() => parseShortCallSettings("0", "NO CONTESTA", CATALOGO), /entero entre 1 y 60/);
  assert.throws(() => parseShortCallSettings("7.5", "NO CONTESTA", CATALOGO), /entero entre 1 y 60/);
  assert.throws(() => parseShortCallSettings("10", "VOLVER A LLAMAR", CATALOGO), /no está en el flujo/);
  assert.throws(() => parseShortCallSettings("10", "INVENTADO", CATALOGO), /no está en el flujo/);
});

test("migración: idempotente, con topes y sin activar ninguna campaña", () => {
  const sql = sinComentarios(leer("supabase/migrations/20260926150000_cierre_automatico_conexiones_cortas.sql"));
  assert.match(sql, /add column if not exists short_call_seconds integer/);
  assert.match(sql, /add column if not exists short_call_disposition text/);
  assert.match(sql, /drop constraint if exists dialer_campaign_configs_short_call_seconds_check/);
  assert.match(sql, /short_call_seconds between 1 and 60/);
  assert.match(sql, /drop constraint if exists dialer_campaign_configs_short_call_disposition_check/);
  assert.doesNotMatch(sql, /\bupdate\b|\binsert\b|\bdefault\b/i, "queda en null: se activa después con el dueño");
  // No toca columnas ajenas de la tabla (caller_id y compañía).
  const columnas = [...sql.matchAll(/add column if not exists (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(columnas, ["short_call_seconds", "short_call_disposition"]);
  assert.match(leer("scripts/probar-discador-sql.sh"), /20260926150000_cierre_automatico_conexiones_cortas\.sql/);
});

test("ficha: reutiliza la tipificación anticipada y solo marca si no se cambió", () => {
  const ficha = leer("src/components/call-typification-form.tsx");
  assert.match(ficha, /getShortCallFacts\(\{ callId: call\.id \}\)/);
  assert.match(ficha, /decideShortCallClosure\(/);
  // Se arma y se guarda por el mismo efecto que la anticipada.
  assert.match(ficha, /setShortClosure\(\{ talkSeconds: decision\.talkSeconds, reason: decision\.option\.value \}\);[\s\S]*?setArmed\(true\);/);
  assert.match(ficha, /auto && shortClosure !== null && payload\.reason === shortClosure\.reason \? true : undefined/);
  assert.match(ficha, /Cambiar tipificación/);
  assert.match(ficha, /if \(!auto\) setShortClosure\(null\);/);
  assert.match(ficha, /!revision && !call\.management_channel/);
});

test("acción: vuelve a medir y deja el evento de auditoría", () => {
  const acciones = leer("src/app/actions/calls.ts");
  assert.equal(SHORT_CALL_AUTO_CLOSED_EVENT, "call.short_call_auto_closed");
  assert.match(acciones, /short_call_auto_close\?: boolean/);
  assert.match(acciones, /input\.short_call_auto_close && !closeError\s*\? recordShortCallAutoClose/);
  assert.match(acciones, /shortCallClosureQualifies\(facts, reason\)/);
  assert.match(acciones, /event_type: SHORT_CALL_AUTO_CLOSED_EVENT/);
  assert.match(acciones, /dial_attempt_id: facts\.dialAttemptId/);
  assert.match(acciones, /configError\.code === "42703"/, "web antes que la migración no rompe la ficha");
});

test("administrador: Discado ofrece los dos campos y valida contra el catálogo", () => {
  const pagina = leer("src/app/dashboard/admin/campanas/[id]/discado/page.tsx");
  assert.match(pagina, /name="short_call_seconds"/);
  assert.match(pagina, /name="short_call_disposition"/);
  assert.match(pagina, /shortCallDispositionOptions\(await fetchCampaignReasonCatalog\(supabase, id\)\)/);
  const accion = leer("src/app/actions/dialer-config.ts");
  assert.match(accion, /formData\.has\("short_call_seconds"\)/);
  assert.match(accion, /parseShortCallSettings\(/);
});
