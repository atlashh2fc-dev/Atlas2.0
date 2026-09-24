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
  assert.equal(claim.name, "20260924182000_agendas_personales_una_a_la_vez.sql");
  const migration = migrations.find((m) => m.name === claim.name)!.sql;
  // Sigue siendo exclusiva del motor.
  assert.match(claim.body, /auth\.uid\(\)[\s\S]*solo puede ser llamada por el motor/);
  assert.match(
    migration,
    /revoke execute on function public\.claim_due_personal_callbacks\(uuid, integer\) from public, anon, authenticated;/
  );
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
  assert.match(hangup, /personalCallbackHangupEvent/);
  assert.match(hangup, /pauseAgentForWrapUp\(ami, callback\.extension\)/);
});

test("el motor sabe qué intentos son agendas antes de originarlas", () => {
  const loop = read("dialer-engine/src/dialer/campaignLoop.ts");
  const track = loop.indexOf("trackPersonalCallback(");
  const originate = loop.indexOf("await originatePersonalCallback(");
  assert.ok(track >= 0 && originate > track);
  // La capacidad del pool se mide después de entregar agendas.
  assert.ok(loop.indexOf("countAvailableAgents(cfg.campaign_id)") > originate);
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
