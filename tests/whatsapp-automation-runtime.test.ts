import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as replySchema from "../src/lib/mercury-whatsapp-schema.ts";

const nodeRequire = createRequire(import.meta.url);

async function runAutomation(options: {
  initialState?: string; initialEnabled?: boolean; currentEnabled?: boolean;
  currentState?: string; controlError?: boolean; dispatchEnabled?: boolean;
  dispatchState?: string; handoff?: boolean; newerMessageAtDispatch?: boolean;
  newerMessageBeforePrepared?: boolean; finished?: boolean; newerMessageAfterSend?: boolean;
} = {}) {
  let providerCalls = 0;
  let generatedCalls = 0;
  let configReads = 0;
  let conversationReads = 0;
  let latestMessageId = "inbound";
  let handoffCompleted = false;
  let closeCalls = 0;
  const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string) {
      if (name === "handoff_whatsapp_conversation") handoffCompleted = true;
      if (name === "close_whatsapp_conversation") closeCalls++;
      return { data: null, error: null };
    },
    from(table: string) {
      let columns = "";
      let isInsert = false;
      let isUpdate = false;
      let excludedId = "";
      const query = {
        select(value: string) { columns = value; return query; },
        eq: () => query, order: () => query, limit: () => query,
        neq: (_column: string, value: string) => { excludedId = value; return query; },
        insert() { isInsert = true; return query; },
        update(value: Record<string, unknown>) { isUpdate = true; updates.push({ table, value }); return query; },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      function result() {
        if (isUpdate) return { data: null, error: null };
        if (isInsert) {
          if (table === "whatsapp_messages") latestMessageId = `${table}-id`;
          return { data: { id: `${table}-id` }, error: null };
        }
        if (table === "whatsapp_conversations") {
          conversationReads++;
          return { data: {
            id: "conversation", campaign_id: "campaign", status: "open",
            ai_state: conversationReads === 1 ? options.initialState ?? "auto"
              : conversationReads >= 3 ? options.dispatchState ?? (handoffCompleted ? "handoff" : "auto")
                : options.currentState ?? "auto",
            contact_name: "Cliente de prueba", contact_phone: "+56911111111", referral: {},
            campaigns: { name: "Prueba aislada" },
            whatsapp_channels: { status: "active", phone_number_id: "line", display_phone_number: "+56911111112" },
          }, error: null };
        }
        if (table === "whatsapp_ai_configs") {
          configReads++;
          return { data: {
            enabled: configReads === 1 ? options.initialEnabled ?? true
              : configReads >= 3 ? options.dispatchEnabled ?? true : options.currentEnabled ?? true,
            system_prompt: "Prueba", max_history_messages: 24,
          }, error: configReads > 1 && options.controlError ? { message: "unavailable" } : null };
        }
        if (table === "whatsapp_messages") {
          const message = { id: "inbound", direction: "inbound", message_type: "text", text_body: options.finished ? "no gracias" : "¿Qué servicios ofrecen?", created_at: "2026-08-27T15:00:00Z" };
          const latestId = (conversationReads >= 3 && (options.newerMessageAtDispatch
            || (options.newerMessageBeforePrepared && excludedId === latestMessageId)))
            || (providerCalls > 0 && options.newerMessageAfterSend) ? "new-inbound"
              : excludedId === latestMessageId ? "inbound" : latestMessageId;
          return { data: columns.includes("created_at") ? [message]
            : columns === "id" ? { id: latestId }
              : message, error: null };
        }
        if (table === "whatsapp_closure_reasons") return { data: { id: "reason" }, error: null };
        throw new Error(`unexpected table ${table}`);
      }
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "./mercury-whatsapp-schema.ts": replySchema,
    "./supabase/admin.ts": { createAdminClient: () => client },
    "./whatsapp-provider.ts": {
      whatsappProvider: () => "test",
      sendWhatsAppTypingIndicator: async () => {},
      sendWhatsAppText: async () => { providerCalls++; return { provider: "test", providerMessageId: "fake", payload: {} }; },
    },
  };
  const source = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const testModule = { exports: {} as { respondToWhatsAppInbound: (input: { conversationId: string; inboundMessageId: string }) => Promise<{ status: string; closed?: boolean }> } };
  vm.runInNewContext(compiled.outputText, {
    module: testModule, exports: testModule.exports, console, Date, Intl, AbortSignal,
    process: { env: { INCEPTION_API_KEY: "local-test-only" } },
    require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
    fetch: async () => {
      generatedCalls++;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: "Ofrecemos atención comercial.", handoff: options.handoff ?? false, handoff_kind: options.handoff ? "human_requested" : "none", handoff_reason: options.handoff ? "Solicita atención humana" : "", appointment_at: null }) } }] }) };
    },
  });
  const result = await testModule.exports.respondToWhatsAppInbound({ conversationId: "conversation", inboundMessageId: "inbound" });
  return { result, providerCalls, generatedCalls, configReads, updates, closeCalls };
}

for (const state of ["handoff", "paused"]) {
  test(`enabling general AI does not reclaim an existing human-owned ${state} thread`, async () => {
    const run = await runAutomation({ initialState: state });
    assert.equal(run.result.status, "skipped");
    assert.equal(run.generatedCalls, 0);
    assert.equal(run.providerCalls, 0);
  });
}

test("general AI pause prevents generation", async () => {
  const run = await runAutomation({ initialEnabled: false });
  assert.equal(run.result.status, "skipped");
  assert.equal(run.generatedCalls, 0);
  assert.equal(run.providerCalls, 0);
});

for (const options of [{ currentEnabled: false }, { currentState: "handoff" }, { controlError: true }]) {
  test(`AI rechecks control and ownership after generation: ${JSON.stringify(options)}`, async () => {
    const run = await runAutomation(options);
    assert.equal(run.generatedCalls, 1);
    assert.equal(run.configReads, 2);
    assert.equal(run.result.status, "skipped");
    assert.equal(run.providerCalls, 0);
  });
}

test("normal AI response sends once and does not reset ownership or reopen a thread", async () => {
  const run = await runAutomation();
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  const conversationWrites = run.updates.filter((item) => item.table === "whatsapp_conversations");
  assert.equal(conversationWrites.length, 1);
  assert.equal("ai_state" in conversationWrites[0].value, false);
  assert.equal("status" in conversationWrites[0].value, false);
});

for (const options of [{ dispatchEnabled: false }, { dispatchState: "handoff" }, { newerMessageAtDispatch: true }, { newerMessageBeforePrepared: true }]) {
  test(`AI cancels a prepared response before dispatch: ${JSON.stringify(options)}`, async () => {
    const run = await runAutomation(options);
    assert.equal(run.generatedCalls, 1);
    assert.equal(run.configReads, 3);
    assert.equal(run.result.status, "skipped");
    assert.equal(run.providerCalls, 0);
    assert.ok(run.updates.some((item) => item.table === "whatsapp_messages" && item.value.status === "failed"));
  });
}

test("AI may deliver the handoff confirmation after its own routing, without reclaiming ownership", async () => {
  const run = await runAutomation({ handoff: true });
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  assert.ok(run.updates.filter((item) => item.table === "whatsapp_conversations").every((item) => !("ai_state" in item.value)));
});

test("a new inbound after delivery prevents an automatic close and is reported as not closed", async () => {
  const run = await runAutomation({ finished: true, newerMessageAfterSend: true });
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  assert.equal(run.closeCalls, 0);
  assert.equal(run.result.closed, false);
});

test("an unchanged customer goodbye can still close normally", async () => {
  const run = await runAutomation({ finished: true });
  assert.equal(run.result.status, "completed");
  assert.equal(run.closeCalls, 1);
  assert.equal(run.result.closed, true);
});
