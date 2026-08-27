import assert from "node:assert/strict";
import test from "node:test";
import { conversationEvidence, decideNextAction, loopReviewSchema, validateConversationFacts, type LoopSource } from "../src/lib/ai-learning-loop.ts";
import { extractConversationFacts, processLearningLoop } from "../src/lib/ai-learning-loop-worker.ts";

const now = new Date("2026-08-27T18:00:00Z");
function source(): LoopSource {
  return { recording_id: "r", call_id: "c", lead_id: "l", campaign_id: "campaign", source_hash: "hash",
    transcript_text: "Por favor llámeme el viernes. Gracias.",
    call: { started_at: "2026-08-27T17:00:00Z", ended_at: "2026-08-27T17:05:00Z", updated_at: "2026-08-27T17:06:00Z", outcome: "callback", reason: "Solicita llamado", next_action_at: null },
    lead: { next_action_at: null, workflow_status: "managed", assigned_to: "a" },
    campaign_active: true, has_open_call: false, memory: [],
  };
}
const analysis = { uncertain: false, facts: [{ kind: "callback_request" as const, quote: "Por favor llámeme el viernes.", speaker: "customer" as const, requested_time_text: "el viernes" }] };

test("loop extraction: indexed fragments preserve literal punctuation, accents and long source text", () => {
  const transcript = "  Sí, llámeme el viernes.\nNo cambie mí puntuación! " + "texto largo ".repeat(100);
  const evidence = conversationEvidence(transcript);
  assert.ok(evidence.length > 3);
  for (const [index, fragment] of evidence.entries()) {
    assert.equal(fragment.id, index);
    assert.ok(fragment.text.length <= 500);
    assert.ok(transcript.includes(fragment.text));
  }
});

test("loop extraction: short customer replies remain in context", () => {
  const evidence = conversationEvidence("¿Quiere retomar?\nNo\n¿Necesita otra cosa?\nSí");
  assert.deepEqual(evidence.map((item) => item.text), ["¿Quiere retomar?", "No", "¿Necesita otra cosa?", "Sí"]);
});

test("loop extraction: provider selects IDs; Atlas retrieves the original quote", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const evidence = JSON.parse(body.messages[1].content).evidence;
    assert.equal(evidence[0].text, analysis.facts[0].quote);
    assert.equal(body.response_format.json_schema.schema.properties.facts.items.properties.quote, undefined);
    return Response.json({ id: "fixture", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ uncertain: false, facts: [
      { kind: "callback_request", speaker: "customer", evidence_id: 0, requested_time_text: "el viernes" },
    ] }) } }] });
  });
  const result = await extractConversationFacts(source(), "fixture-key");
  assert.deepEqual(result.analysis, analysis);
});

test("loop extraction: invalid IDs, truncated JSON and invalid schema fail with safe diagnostics", async (t) => {
  let content = JSON.stringify({ uncertain: false, facts: [{ kind: "callback_request", speaker: "customer", evidence_id: 999, requested_time_text: null }] });
  let finish = "stop";
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: finish, message: { content } }] }));
  await assert.rejects(extractConversationFacts(source(), "fixture"), /provider_invalid_schema/);
  finish = "length";
  await assert.rejects(extractConversationFacts(source(), "fixture"), /provider_output_incomplete/);
  finish = "stop"; content = "not JSON";
  await assert.rejects(extractConversationFacts(source(), "fixture"), /provider_invalid_json/);
});

test("loop: requires literal evidence and time; never manufactures dates", () => {
  assert.deepEqual(validateConversationFacts(analysis, source().transcript_text), analysis);
  assert.throws(() => validateConversationFacts({ ...analysis, facts: [{ ...analysis.facts[0], quote: "Llámame mañana" }] }, source().transcript_text), /evidence_not_in_source/);
  assert.throws(() => validateConversationFacts({ ...analysis, facts: [{ ...analysis.facts[0], requested_time_text: "2026-08-28T15:00Z" }] }, source().transcript_text), /time_not_in_evidence/);
  assert.throws(() => validateConversationFacts({ ...analysis, facts: [analysis.facts[0], analysis.facts[0]] }, source().transcript_text), /duplicate_fact/);
});

test("loop: callback is a shadow proposal, never an executed action", () => {
  const decision = decideNextAction(source(), analysis, now);
  assert.equal(decision.action, "callback_candidate");
  assert.equal(decision.execution, "not_executed_shadow");
  assert.equal(decision.policy_version, "callback-v1");
});

test("loop: deterministic operational guards take precedence", () => {
  assert.equal(decideNextAction({ ...source(), campaign_active: false }, analysis, now).reason_code, "campaign_inactive");
  assert.equal(decideNextAction({ ...source(), has_open_call: true }, analysis, now).reason_code, "open_call");
  const scheduled = { ...source(), lead: { ...source().lead, next_action_at: "2026-08-28T15:00:00Z" } };
  assert.equal(decideNextAction(scheduled, analysis, now).reason_code, "existing_followup");
  assert.equal(decideNextAction(source(), { ...analysis, uncertain: true }, now).action, "human_review");
  assert.equal(decideNextAction(source(), { uncertain: false, facts: [{ ...analysis.facts[0], speaker: "agent" }] }, now).action, "no_action");
});

test("loop: confirmed previous memory closes the feedback path, expired memory does not", () => {
  const empty = { uncertain: false, facts: [] };
  const withMemory = { ...source(), memory: [{ id: "m1", kind: "commitment" as const, expires_at: "2026-08-29T00:00:00Z" }] };
  assert.equal(decideNextAction(withMemory, empty, now).reason_code, "confirmed_memory");
  const restricted = { ...source(), memory: [{ ...withMemory.memory[0], kind: "contact_restriction" as const }] };
  assert.equal(decideNextAction(restricted, analysis, now).action, "human_review", "a new callback cannot bypass confirmed context");
  assert.deepEqual(decideNextAction(withMemory, empty, now).memory_ids, ["m1"]);
  assert.equal(decideNextAction(withMemory, empty, new Date("2026-08-30T00:00:00Z")).action, "no_action");
});

test("loop: review separately records recommendation and extraction", () => {
  assert.equal(loopReviewSchema.safeParse({ runId: "00000000-0000-4000-8000-000000000001", expectedVersion: 0, recommendation: "accepted", extraction: "unreviewed", note: "Revisar horario" }).success, true);
  assert.equal(loopReviewSchema.safeParse({ runId: "bad", expectedVersion: -1, recommendation: "execute", extraction: "confirmed", note: "" }).success, false);
});

test("loop worker: claim → validated extraction → decision → atomic completion", async () => {
  const names: string[] = [];
  let persisted: Record<string, unknown> = {};
  const client = { async rpc(name: string, args?: Record<string, unknown>) {
    names.push(name);
    if (name === "claim_ai_loop_run") return { data: { id: "job", lease_token: "lease", source: source() }, error: null };
    persisted = args ?? {};
    return { data: true, error: null };
  } };
  const result = await processLearningLoop(client, async () => ({ analysis, provider_request_id: "provider-1", usage: { total_tokens: 20 } }), () => now);
  assert.deepEqual(names, ["claim_ai_loop_run", "complete_ai_loop_run"]);
  assert.equal(result.completed, 1);
  assert.equal(persisted.p_lease_token, "lease");
  assert.equal(((persisted.p_result as { decision: { execution: string } }).decision.execution), "not_executed_shadow");
});

test("loop worker: empty queue performs no provider request", async () => {
  let invoked = false;
  const result = await processLearningLoop({ async rpc() { return { data: null, error: null }; } }, async () => { invoked = true; throw new Error("unexpected"); });
  assert.equal(invoked, false);
  assert.equal(result.claimed, 0);
});

test("loop worker: invalid evidence stores safe error and never completes", async () => {
  const names: string[] = [];
  const client = { async rpc(name: string, args?: Record<string, unknown>) {
    names.push(name);
    if (name === "claim_ai_loop_run") return { data: { id: "job", lease_token: "lease", source: source() }, error: null };
    assert.equal(args?.p_error_code, "evidence_not_in_source");
    return { data: true, error: null };
  } };
  const result = await processLearningLoop(client, async () => ({ analysis: { ...analysis, facts: [{ ...analysis.facts[0], quote: "invented evidence" }] }, provider_request_id: null, usage: {} }));
  assert.equal(result.failed, 1);
  assert.deepEqual(names, ["claim_ai_loop_run", "fail_ai_loop_run"]);
});

test("loop worker: a rejected lease is never reported as completed", async () => {
  const client = { async rpc(name: string) { return { data: name === "claim_ai_loop_run" ? { id: "job", lease_token: "lease", source: source() } : false, error: null }; } };
  const result = await processLearningLoop(client, async () => ({ analysis, provider_request_id: null, usage: {} }));
  assert.equal(result.completed, 0);
  assert.equal(result.superseded, 1);
});
