// Abandono real del predictivo (26-09-2026).
//
// En Equifax 26 intentos del pool contestados nunca llegaron a una ejecutiva y
// quedaron 'completed' causa 16; ninguno 'abandoned'. El motor esperaba un
// DialEnd ANSWER que en Originate→Queue casi nunca llega, y la tasa de
// abandono usaba answered_at como denominador: sin señal, el predictivo crecía
// hacia la demanda a ciegas. Además las campañas Andes tenían la meta como
// fracción (0,03), 100 veces más estricta que el 3 % de Equifax.
//
// La decisión se prueba como función pura en dialer-engine
// (eventSemantics.test.ts) y el backfill en tests/sql/discador/escenarios.sql.
// Aquí se vigila que las piezas sigan conectadas.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  originateResponseMeansCustomerAnswered,
  outboundHangupEvent,
} from "../dialer-engine/src/ami/eventSemantics.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const sinComentarios = (texto: string) => texto.replace(/--[^\n]*/g, "");

const RUTEADOR = leer("dialer-engine/src/ami/eventRouter.ts");
const CLIENTE = leer("dialer-engine/src/supabaseClient.ts");
const MIGRACION = sinComentarios(leer("supabase/migrations/20260926130000_abandono_real_y_meta_en_porcentaje.sql"));
const ACCION = leer("src/app/actions/dialer-config.ts");
const FORMULARIO = leer("src/app/dashboard/admin/campanas/[id]/discado/page.tsx");

test("pool contestado sin ejecutiva es abandono; con ejecutiva, buzón o agenda no", () => {
  const answered = originateResponseMeansCustomerAnswered({ success: true, personalCallback: false });
  assert.equal(answered, true);
  const base = { voicemail: false, personalCallback: null, answered, cause: "16" };
  assert.equal(outboundHangupEvent({ ...base, bridged: false }), "abandoned");
  assert.equal(outboundHangupEvent({ ...base, bridged: true }), "completed");
  assert.equal(outboundHangupEvent({ ...base, bridged: false, voicemail: true }), "voicemail");
  assert.equal(originateResponseMeansCustomerAnswered({ success: true, personalCallback: true }), false);
});

test("el router marca contestado en el OriginateResponse y registra 'answered' detrás de 'originating'", () => {
  const originate = RUTEADOR.slice(RUTEADOR.indexOf('case "originateresponse"'), RUTEADOR.indexOf('case "dialbegin"'));
  assert.match(originate, /originateResponseMeansCustomerAnswered\(\{\s*success,\s*personalCallback: getPersonalCallback\(actionId\) !== undefined/);
  const originating = originate.indexOf('"register_dial_event (originate)"');
  const answered = originate.indexOf('"register_dial_event (answered)"');
  assert.ok(originating !== -1 && answered > originating, "'answered' va después de 'originating' en la misma cola");
  // DialEnd ANSWER no lo repite: register_dial_event solo descarta rangos menores.
  assert.match(RUTEADOR, /if \(!alreadyAnswered\) \{\s*enqueueAttemptTask\(dialAttemptId, "register_dial_event \(answered\)"/);
  assert.match(RUTEADOR, /const eventType = outboundHangupEvent\(\{/);
});

test("la tasa de abandono mide sobre lo que el cliente contestó, solo en el pool", () => {
  const inicio = CLIENTE.indexOf("export async function getRecentAbandonmentRate");
  const cuerpo = CLIENTE.slice(inicio, CLIENTE.indexOf("\n}\n", inicio));
  assert.doesNotMatch(cuerpo, /answered_at/);
  assert.match(cuerpo, /\.not\("originated_at", "is", null\)/);
  assert.equal(cuerpo.match(/\.eq\("attempt_kind", "pool"\)/g)?.length, 2);
  assert.match(cuerpo, /\.eq\("status", "abandoned"\)/);
  assert.match(cuerpo, /\* 100;/);
});

test("la meta de abandono es porcentaje en la base y en el formulario", () => {
  assert.match(MIGRACION, /set target_abandonment_rate = target_abandonment_rate \* 100/);
  assert.match(MIGRACION, /where target_abandonment_rate > 0\s+and target_abandonment_rate < 1;/);
  assert.match(MIGRACION, /check \(target_abandonment_rate >= 1 and target_abandonment_rate <= 100\)/);
  assert.match(MIGRACION, /drop constraint if exists dialer_configs_target_abandonment_check/);
  assert.match(ACCION, /targetAbandonmentRate < 1 \|\| targetAbandonmentRate > 100/);
  assert.match(FORMULARIO, /name="target_abandonment_rate"\s+step="0\.5"\s+min="1"/);
});

test("el backfill solo reclasifica contestados del pool sin ejecutiva", () => {
  const backfill = MIGRACION.slice(MIGRACION.indexOf("update public.dial_attempts"));
  for (const condicion of [
    "attempt_kind = 'pool'",
    "status = 'completed'",
    "originated_at is not null",
    "bridged_at is null",
    "ended_at is not null",
    // AgentConnect confirmado = hubo conversación aunque falte el bridge.
    "agent_id is null",
  ]) {
    assert.ok(backfill.includes(condicion), `falta ${condicion}`);
  }
  assert.match(backfill, /set status = 'abandoned'/);
});
