import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { processLearningLoop } from "../src/lib/ai-learning-loop-worker.ts";

// Uses the real TS worker and migration RPCs. Only the model is substituted;
// fixtures and a Unix socket prevent accidental production/provider access.
const socket = process.argv[2];
assert.match(socket ?? "", /^\/tmp\/atlas-learning-loop\.[A-Za-z0-9]+$/);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const literal = (value: unknown) => value === null ? "null" : typeof value === "number" ? String(value)
  : `'${(typeof value === "object" ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`;
function sql(query: string, actor?: number): string {
  const prefix = actor ? `set role authenticated; set request.jwt.claim.sub=${literal(id(actor))};` : "set role service_role;";
  const result = spawnSync("psql", ["-X", "-qAt", "-h", socket, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", prefix + query], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const functions: Record<string, string[]> = {
  claim_ai_loop_run: ["p_worker", "p_policy_version"],
  complete_ai_loop_run: ["p_run_id", "p_lease_token", "p_result"],
  fail_ai_loop_run: ["p_run_id", "p_lease_token", "p_error_code"],
};
const client = {
  async rpc(name: string, args: Record<string, unknown> = {}) {
    assert.ok(Object.hasOwn(functions, name));
    const values = functions[name].map((key) => `${key}=>${literal(args[key])}`).join(",");
    try { return { data: JSON.parse(sql(`select coalesce(to_jsonb(public.${name}(${values})),'null'::jsonb)`)), error: null }; }
    catch (error) { return { data: null, error: { message: String(error) } }; }
  },
};
function addSource(n: number, transcript: string) {
  sql(`insert into calls(id,lead_id,agent_id,status,outcome,reason,started_at,ended_at) values
    (${literal(id(n))},${literal(id(301))},${literal(id(1))},'completed','callback','Fixture',clock_timestamp(),clock_timestamp());
    insert into call_recordings(id,call_id,lead_id,campaign_id,team_id,started_at,sha256) values
    (${literal(id(n+100))},${literal(id(n))},${literal(id(301))},${literal(id(101))},${literal(id(201))},clock_timestamp(),repeat('a',64));
    insert into call_transcriptions(id,recording_id,status,source_sha256,transcript_text) values
    (${literal(id(n+200))},${literal(id(n+100))},'completed',repeat('a',64),${literal(transcript)});`);
}

sql(`select configure_ai_loop(${literal(id(101))},'shadow',20)`, 4);
addSource(505, "Cliente: Por favor llámeme el viernes. Agente: Gracias.");
const callsBefore = sql("select count(*) from calls");
const leadBefore = sql(`select to_jsonb(l) from leads l where id=${literal(id(301))}`);
const first = await processLearningLoop(client, async () => ({ analysis: { uncertain: false, facts: [
  { kind: "callback_request", quote: "Por favor llámeme el viernes.", speaker: "customer", requested_time_text: "el viernes" },
] }, provider_request_id: "synthetic-model-1", usage: {} }));
assert.equal(first.completed, 1);
const run = sql(`select id from ai_loop_runs where recording_id=${literal(id(605))} and status='completed'`);
assert.ok(run);
assert.equal(sql(`select decision->>'action' from ai_loop_runs where id=${literal(run)}`), "callback_candidate");
assert.equal(sql("select count(*) from calls"), callsBefore, "worker never starts a contact");
assert.equal(sql(`select to_jsonb(l) from leads l where id=${literal(id(301))}`), leadBefore, "worker never changes lead/agenda/assignment");
assert.equal(sql(`select get_ai_loop_memory(${literal(id(301))})`, 3), "[]", "candidates never enter 360 memory");
sql(`select review_ai_loop_decision(${literal(run)},0,'accepted','confirmed','Fuente verificada en fixture')`, 3);
const memory = JSON.parse(sql(`select get_ai_loop_memory(${literal(id(301))})`, 3));
assert.equal(memory.length, 1);
assert.equal(memory[0].run_id, run);
sql(`begin;
  select retract_ai_loop_memory(${literal(memory[0].id)},'Retiro para comprobar irreversibilidad');
  select review_ai_loop_decision(${literal(run)},1,'accepted','confirmed','Revisión posterior al retiro');
  select assert_test(not exists(select 1 from ai_loop_memory where id=${literal(memory[0].id)} and state='confirmed'),'review cannot revive a withdrawn fact');
  rollback;`, 3);
assert.equal(sql(`select get_ai_loop_memory(${literal(id(301))})`, 1), "[]", "agents cannot read shadow memory");
assert.equal(sql(`select get_ai_loop_memory(${literal(id(301))})`, 5), "[]", "another team cannot read 360 memory");

addSource(506, "Agente: Buenos días. Cliente: Gracias.");
const second = await processLearningLoop(client, async (source) => {
  assert.deepEqual(source.memory.map((fact) => fact.id), [memory[0].id]);
  return { analysis: { uncertain: false, facts: [] }, provider_request_id: "synthetic-model-2", usage: {} };
});
assert.equal(second.completed, 1);
const decision = JSON.parse(sql(`select decision from ai_loop_runs where recording_id=${literal(id(606))} and status='completed'`));
assert.equal(decision.reason_code, "confirmed_memory");
assert.deepEqual(decision.memory_ids, [memory[0].id]);
assert.equal(decision.execution, "not_executed_shadow");
assert.equal(sql(`select count(*) from ai_loop_feedback where run_id=${literal(run)} and kind='observed_outcome' and source_call_id=${literal(id(506))}`), "1");
sql(`update calls set outcome='sale',reason='Resultado corregido',updated_at=clock_timestamp() where id=${literal(id(506))}`);
assert.equal(sql(`select count(*) from ai_loop_feedback where run_id=${literal(run)} and kind='observed_outcome' and source_call_id=${literal(id(506))}`), "2");
assert.equal(sql(`select count(*) from ai_loop_feedback where run_id=${literal(run)} and kind='human_review'`), "1");
sql(`update calls set reason='Corrección sin alterar transcripción',updated_at=clock_timestamp() where id=${literal(id(505))};
  update ai_loop_runs set expires_at=now()-interval '1 second' where id=${literal(run)};`);
assert.equal(JSON.parse(sql(`select get_ai_loop_memory(${literal(id(301))})`, 3)).length, 1, "facts outlive decision validity");
assert.throws(() => sql(`select retract_ai_loop_memory(${literal(memory[0].id)},'Equipo ajeno')`, 5), /not_authorized/);
assert.equal(sql(`select retract_ai_loop_memory(${literal(memory[0].id)},'Se detectó atribución incorrecta')`, 3), "t");
assert.equal(sql(`select retract_ai_loop_memory(${literal(memory[0].id)},'Reintento de retiro')`, 3), "f", "retraction is idempotent");
assert.equal(sql(`select get_ai_loop_memory(${literal(id(301))})`, 3), "[]", "expired/superseded decisions do not trap incorrect memory");
assert.equal(sql(`select count(*) from ai_loop_feedback where run_id=${literal(run)} and payload->>'scope'='memory_retraction'`), "1");
// Quota cannot be reset by toggling configuration, even while another run waits.
sql(`select configure_ai_loop(${literal(id(101))},'off',1)`, 4);
sql(`select configure_ai_loop(${literal(id(101))},'shadow',1)`, 4);
assert.equal((await client.rpc("claim_ai_loop_run", { p_worker: id(900), p_policy_version: "callback-v1" })).data, null);
sql(`update call_recordings set status='archived' where id=${literal(id(605))}`);
assert.equal(sql(`select get_ai_loop_memory(${literal(id(301))})`, 3), "[]", "withdrawn source disappears from 360");
console.log("PASS: real worker + PostgreSQL → supervisor → 360 memory → next decision → observed outcome revisions; no operational writes.");
