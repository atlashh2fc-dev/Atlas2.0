import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Hallazgo B3 de la auditoría de Equifax: las agendas personales llegaban sin
// grabación ni ficha, quedaban 'abandoned', se volvían a marcar tras hablar y
// salían varias juntas para el mismo ejecutivo.

const MIGRATIONS_DIR = "supabase/migrations";
const migrations = readdirSync(MIGRATIONS_DIR)
  .sort()
  .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8") }));

/** Última definición aplicada de una función, en orden de migración. */
function latestDefinition(functionName: string) {
  const marker = new RegExp(`create or replace function public\\.${functionName}\\(`);
  const owner = [...migrations].reverse().find((migration) => marker.test(migration.sql));
  assert.ok(owner, `Ninguna migración define ${functionName}`);
  const start = owner.sql.search(marker);
  return { name: owner.name, body: owner.sql.slice(start, owner.sql.indexOf("$function$;", start)) };
}

const claim = latestDefinition("claim_due_personal_callbacks");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("la entrega de agendas vive en la migración que la corrige", () => {
  // 20260925090000 la redefinió para respetar el AUX y 20261015220000 para
  // entregar la agenda antes de devolver al ejecutivo a la cola, sin soltar
  // ninguna de estas reglas.
  assert.equal(claim.name, "20261015220000_agenda_vencida_antes_que_la_cola.sql");
  const migration = migrations.find((m) => m.name === claim.name)!.sql;
  // Sigue siendo exclusiva del motor.
  assert.match(claim.body, /auth\.uid\(\)[\s\S]*solo puede ser llamada por el motor/);
  assert.match(
    migration,
    /revoke execute on function public\.claim_due_personal_callbacks\(uuid, integer, uuid\) from public, anon, authenticated;/
  );
  // Sin la firma vieja: la llamada (p_campaign_id, p_limit) no puede quedar ambigua.
  assert.match(migration, /drop function if exists public\.claim_due_personal_callbacks\(uuid, integer\);/);
});

test("una sola agenda en vuelo por ejecutivo, las demás esperan en orden", () => {
  // El candado consultivo es reentrante dentro de la transacción: el freno real
  // es el arreglo de dueños ya entregados en esta llamada.
  assert.match(claim.body, /continue when v_candidate\.owner_id = any\(v_owners\)/);
  assert.match(claim.body, /v_owners := v_owners \|\| v_candidate\.owner_id/);
  assert.match(claim.body, /order by l\.next_action_at asc/);
  // Tampoco sale si el dueño ya tiene cualquier intento vivo o gestión abierta.
  assert.match(claim.body, /busy\.agent_id = v_candidate\.owner_id/);
  assert.match(claim.body, /open_call\.agent_id = v_candidate\.owner_id/);
  assert.match(claim.body, /intercall_break_until > v_now/);
  assert.match(claim.body, /reason\.code = 'desconectado'/);
});

test("después de una conversación o de tomarla a mano la agenda no se vuelve a marcar", () => {
  assert.match(claim.body, /c\.ended_at is null or c\.started_at >= l\.next_action_at/);
  assert.match(claim.body, /answered\.answered_at is not null/);
});

test("al cliente se le hace sonar como máximo dos veces y con espera entre ambas", () => {
  assert.match(claim.body, /v_max_customer_rings constant integer := 2/);
  assert.match(claim.body, /v_customer_ring_gap constant interval := interval '10 minutes'/);
  // Solo cuenta lo que llegó al cliente: el ejecutivo ya había contestado.
  assert.match(claim.body, /rung\.originated_at is not null/);
});

test("un número tomado por el pool no tumba la entrega de las demás agendas", () => {
  assert.match(claim.body, /canonical_chile_phone\(da2\.phone\) = public\.canonical_chile_phone\(l\.phone\)/);
  assert.match(claim.body, /exception when unique_violation then/);
});

test("la agenda automática respeta horario, multiskill y lista de no llamar", () => {
  assert.match(claim.body, /if not public\.dialer_campaign_in_calling_window\(p_campaign_id\) then\s+return;/);
  assert.match(claim.body, /get_active_campaign_agent_extensions\(p_campaign_id\)/);
  assert.match(claim.body, /s\.extension = any\(v_active_extensions\)/);
  assert.match(claim.body, /not public\.dialer_phone_is_suppressed\(l\.organization_id, p_campaign_id, l\.phone\)/);
  // El resguardo de dial_attempts descarta sin fila: no se entrega un intento vacío.
  assert.match(claim.body, /continue when v_attempt_id is null;/);
  // Una falla de troncal no gasta los timbres de cortesía del cliente.
  assert.match(claim.body, /rung\.status <> 'failed'/);
});

test("el motor registra la conexión de la agenda cuando el cliente contesta", () => {
  const router = read("dialer-engine/src/ami/eventRouter.ts");
  const dialEnd = router.slice(router.indexOf('case "dialend"'), router.indexOf('case "agentconnect"'));
  assert.match(dialEnd, /getPersonalCallback\(dialAttemptId\)/);
  assert.match(dialEnd, /state\.bridged = true/);
  // Misma conexión que el pool: confirma, crea la calls, graba y abre la ficha.
  assert.match(dialEnd, /connectAgentToAttempt\(/);
  const connect = router.slice(router.indexOf("async function connectAgentToAttempt"), router.indexOf('ami.on("managerevent"'));
  assert.match(connect, /confirmDialAttemptAgent/);
  assert.match(connect, /eventType: "bridged"/);
  assert.match(connect, /emitIncomingDialEvent/);
  assert.match(connect, /recording\.start/);

  const hangup = router.slice(router.indexOf('case "hangup"'), router.indexOf('case "userevent"'));
  // La decisión vive en outboundHangupEvent, que resuelve la agenda con
  // personalCallbackHangupEvent antes de mirar el abandono del pool.
  assert.match(hangup, /outboundHangupEvent\(\{[\s\S]*personalCallback: callback/);
  const semantics = read("dialer-engine/src/ami/eventSemantics.ts");
  const decision = semantics.slice(semantics.indexOf("export function outboundHangupEvent"));
  assert.ok(decision.indexOf("return personalCallbackHangupEvent(") !== -1);
  assert.ok(decision.indexOf("return personalCallbackHangupEvent(") < decision.indexOf('return "abandoned"'));
  assert.match(hangup, /pauseAgentForWrapUp\(ami, callback\.extension\)/);
});

test("el motor sabe qué intentos son agendas antes de originarlas", () => {
  const delivery = read("dialer-engine/src/dialer/personalCallbackDelivery.ts");
  const track = delivery.indexOf("trackPersonalCallback(");
  const hold = delivery.indexOf("await holdAgentWhileBusy(");
  const originate = delivery.indexOf("await originatePersonalCallback(");
  assert.ok(track >= 0 && hold > track && originate > hold);
  // La capacidad del pool se mide después de entregar agendas.
  const loop = read("dialer-engine/src/dialer/campaignLoop.ts");
  const deliver = loop.indexOf("await deliverPersonalCallbacks(ami, cfg, callbacks)");
  assert.ok(deliver >= 0 && loop.indexOf("countAvailableAgents(cfg.campaign_id)") > deliver);
  const client = read("dialer-engine/src/supabaseClient.ts");
  assert.match(client, /\.eq\("attempt_kind", "personal_callback"\)[\s\S]*busyAgents/);
});

test("la barra reconoce la agenda desde el primer timbre del ejecutivo", () => {
  const sip = read("src/app/actions/agent-sip.ts");
  assert.match(sip, /and\(attempt_kind\.eq\.personal_callback,status\.in\.\(queued,originating\)\)/);
});

test("la ficha deja llamar la agenda propia aunque no esté asignada", () => {
  const detail = read("src/app/dashboard/leads/[id]/page.tsx");
  assert.match(detail, /\(lead\.managed_by \?\? lead\.assigned_to\) === profile\.id/);
  assert.match(detail, /source=\{ownsAgenda \? "agenda" : "assigned_lead"\}/);
});

// 15-10-2026: 41 de 140 agendas salieron con más de 10 minutos de atraso. Al
// volver de un AUX o al terminar de tipificar, Asterisk despausaba al
// ejecutivo y le pasaba el cliente del pool que esperaba en la cola antes de
// que el motor pidiera su agenda (13 veces ese día).
test("la agenda vencida se pide antes de devolver al ejecutivo a la cola", () => {
  // Solo con p_agent_id se acepta la sesión todavía pausada en Asterisk.
  assert.match(claim.body, /p_agent_id uuid default null/);
  assert.match(claim.body, /s\.status = 'available' or \(p_agent_id is not null and s\.status = 'paused'\)/);
  assert.match(claim.body, /p_agent_id is null or coalesce\(l\.managed_by, l\.assigned_to\) = p_agent_id/);
  // Pausado en Asterisk solo vale si el CRM lo muestra trabajando, no en AUX.
  assert.match(
    claim.body,
    /continue when v_candidate\.session_status = 'paused' and not exists \([\s\S]*not reason\.is_pause[\s\S]*reason\.code <> 'desconectado'/
  );

  // Fin de tipificación: la agenda antes de despausar.
  const release = read("dialer-engine/src/dialer/agentRelease.ts");
  const agenda = release.indexOf("await deliverDueAgendaBeforeQueue(ami, profileId)");
  assert.ok(agenda >= 0 && agenda < release.indexOf("await resumeAgentAfterWrapUp(ami, extension)"));

  // Vuelta de un AUX (y respaldo del evento): el sync pregunta antes de despausar.
  const pause = read("dialer-engine/src/dialer/agentPause.ts");
  const sync = pause.slice(pause.indexOf("export async function syncAgentPauseStates"));
  const guard = sync.indexOf("keepOutForAgenda(state.profileId, state.extension)");
  assert.ok(guard >= 0 && guard < sync.indexOf('Action: "QueuePause"'));
  assert.match(read("dialer-engine/src/server.ts"), /setResumeGuard\(\(profileId\) => deliverDueAgendaBeforeQueue\(ami, profileId\)\)/);

  // El motor pide la agenda de ese ejecutivo y nada más.
  const delivery = read("dialer-engine/src/dialer/personalCallbackDelivery.ts");
  assert.match(delivery, /claimDuePersonalCallbacks\(campaignId, 1, profileId\)/);
  assert.match(read("dialer-engine/src/supabaseClient.ts"), /p_agent_id: agentId/);
});
