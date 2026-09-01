import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import {
  assertCanOperateAssignedConversation,
  canOperateAssignedConversation,
  getWorkspacePermissions,
} from "../src/lib/workspace-permissions.ts";
import type { AppRole } from "../src/lib/types.ts";

const nodeRequire = createRequire(import.meta.url);
const conversationId = "10000000-0000-4000-8000-000000000001";
const uploadId = "10000000-0000-4000-8000-000000000002";
const agentId = "10000000-0000-4000-8000-000000000003";

function loadModule(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} as Record<string, (...args: never[]) => Promise<unknown>> };
  vm.runInNewContext(compiled.outputText, {
    module: loadedModule, exports: loadedModule.exports,
    require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
    console, FormData, Date,
  }, { filename: path });
  return loadedModule.exports;
}

function harness(role: AppRole, assignedTo: string | null = agentId, aiState = "handoff", automationEnabled: boolean | null = true, claimFailure: "error" | "missing" | null = null) {
  const profile = { id: agentId, role, active: true };
  const writes: string[] = [];
  let reads = 0;
  let providerCalls = 0;
  const conversation = {
    id: conversationId, assigned_to: assignedTo, status: "open", campaign_id: "campaign",
    channel_id: "channel", contact_phone: "+56911111111", ai_state: aiState,
  };
  const records: Record<string, unknown> = {
    whatsapp_conversations: conversation,
    whatsapp_channels: { status: "active", phone_number_id: "phone-id", display_phone_number: "+56911111112" },
    whatsapp_ai_configs: automationEnabled === null ? null : { enabled: automationEnabled },
    whatsapp_messages: { id: "message", message_type: "image", conversation_id: conversationId },
    whatsapp_media_uploads: {
      id: uploadId, conversation_id: conversationId, created_by: agentId, status: "prepared",
      expires_at: "2099-01-01", mime_type: "image/jpeg", size_bytes: 10, message_type: "image",
      storage_path: "outbound/image.jpg", storage_bucket: "whatsapp-media", client_reference: "ref",
    },
  };
  function from(table: string) {
    reads++;
    let updating = false;
    const result = () => table === "whatsapp_conversations" && updating && claimFailure
      ? { data: null, error: claimFailure === "error" ? { message: "Database write failed" } : null }
      : { data: records[table], error: null };
    const query = {
      select: () => query, eq: () => query, in: () => query,
      single: async () => result(),
      maybeSingle: async () => result(),
      insert: () => { writes.push(`insert:${table}`); return query; },
      update: () => { updating = true; writes.push(`update:${table}`); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: records[table], error: null }).then(resolve),
    };
    return query;
  }
  const client = {
    from,
    rpc: async (name: string) => { writes.push(`rpc:${name}`); return { error: null }; },
    storage: { from: () => ({
      createSignedUploadUrl: async () => ({ data: { token: "upload-token" }, error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://example.invalid/media" }, error: null }),
      list: async () => ({ data: [{ name: "image.jpg", metadata: { size: 10 } }], error: null }),
    }) },
  };
  const dependencies = {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": {
      requireProfile: async (allowed?: AppRole[]) => {
        if (allowed && !allowed.includes(role)) throw new Error("role_denied");
        return profile;
      },
      getCurrentProfile: async () => profile,
    },
    "@/lib/workspace-permissions": { getWorkspacePermissions, assertCanOperateAssignedConversation },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => client },
    "@/lib/whatsapp-media": {
      WHATSAPP_MEDIA_BUCKET: "whatsapp-media",
      validateWhatsAppMedia: () => ({ extension: "jpg", messageType: "image", mimeType: "image/jpeg" }),
      captureWhatsAppMessageMedia: async () => {},
    },
    "@/lib/whatsapp-provider": {
      isWhatsAppProviderConfigured: () => true, whatsappProvider: () => "test",
      sendWhatsAppText: async () => { providerCalls++; return { providerMessageId: "fake", payload: {} }; },
      sendWhatsAppMedia: async () => { providerCalls++; return { providerMessageId: "fake", payload: {} }; },
    },
  };
  return {
    actions: loadModule("../src/app/actions/whatsapp.ts", dependencies),
    dependencies, writes, reads: () => reads, providerCalls: () => providerCalls,
  };
}

const actionCases: Array<[string, unknown]> = [
  ["sendWhatsAppMessage", new FormData()],
  ["prepareWhatsAppMediaUpload", { conversationId, fileName: "image.jpg", mimeType: "image/jpeg", sizeBytes: 10 }],
  ["sendPreparedWhatsAppMedia", { uploadId, caption: "Hello" }],
  ["markWhatsAppConversationRead", new FormData()],
  ["setWhatsAppConversationStatus", new FormData()],
  ["closeWhatsAppConversation", new FormData()],
];
for (const [, input] of actionCases) {
  if (input instanceof FormData) {
    input.set("conversation_id", conversationId);
    input.set("body", "Prueba sin envío real");
    input.set("status", "pending");
    input.set("reason_id", uploadId);
    input.set("ai_state", "paused");
  }
}

test("workspace capabilities separate administration, supervision and attention", () => {
  assert.equal(getWorkspacePermissions("admin").canReadConversationContent, false);
  assert.equal(getWorkspacePermissions("admin").canAttendCustomers, false);
  assert.equal(getWorkspacePermissions("admin").canConfigurePlatform, true);
  assert.equal(getWorkspacePermissions("supervisor").canReadConversationContent, true);
  assert.equal(getWorkspacePermissions("supervisor").canAttendCustomers, false);
  assert.equal(getWorkspacePermissions("agente").canAttendCustomers, true);
  assert.equal(getWorkspacePermissions("agente").canManageAssignments, false);
  assert.equal(getWorkspacePermissions("unexpected" as AppRole).canAttendCustomers, false);
});

for (const [name, input] of actionCases.filter(([name]) => name === "sendWhatsAppMessage" || name === "sendPreparedWhatsAppMedia")) {
  for (const failure of ["error", "missing"] as const) {
    test(`${name}: human ownership claim ${failure} prevents provider send`, async () => {
      const h = harness("agente", agentId, "handoff", true, failure);
      await assert.rejects(h.actions[name](input as never), /no se pudo confirmar la atención humana/);
      assert.equal(h.providerCalls(), 0);
      assert.equal(h.writes.some((write) => write === "insert:whatsapp_messages"), false);
    });
  }
}

test("ownership checks deny inactive agents and unassigned/other interactions", () => {
  const profile = { id: agentId, role: "agente" as const, active: true };
  assert.equal(canOperateAssignedConversation(profile, agentId), true);
  assert.equal(canOperateAssignedConversation(profile, null), false);
  assert.equal(canOperateAssignedConversation(profile, "another-agent"), false);
  assert.equal(canOperateAssignedConversation({ ...profile, active: false }, agentId), false);
});

for (const [name, input] of actionCases) {
  for (const role of ["admin", "supervisor"] as const) {
    test(`${name}: ${role} denied before database/provider access`, async () => {
      const h = harness(role);
      await assert.rejects(h.actions[name](input as never), /role_denied/);
      assert.equal(h.reads(), 0);
      assert.deepEqual(h.writes, []);
      assert.equal(h.providerCalls(), 0);
    });
  }
  for (const assignedTo of [null, "another-agent"]) {
    test(`${name}: visible but ${assignedTo === null ? "unassigned" : "other agent's"} conversation denied`, async () => {
      const h = harness("agente", assignedTo);
      await assert.rejects(h.actions[name](input as never), /Solo el ejecutivo asignado/);
      assert.deepEqual(h.writes, []);
      assert.equal(h.providerCalls(), 0);
    });
  }
  test(`${name}: assigned agent keeps the normal workflow with mocked provider`, async () => {
    const h = harness("agente");
    await h.actions[name](input as never);
    assert.ok(h.writes.length > 0);
  });
}

test("direct media URL returns 403 for admin before querying messages or signing storage", async () => {
  const h = harness("admin");
  const route = loadModule("../src/app/api/conversaciones/whatsapp/mensajes/[id]/media/route.ts", {
    ...h.dependencies,
    "next/server": { NextResponse: { json: (body: unknown, init: unknown) => ({ body, ...init as object }) } },
  });
  const response = await route.GET({} as never, { params: Promise.resolve({ id: conversationId }) } as never) as { status: number };
  assert.equal(response.status, 403);
  assert.equal(h.reads(), 0);
  assert.deepEqual(h.writes, []);
});

for (const role of ["admin", "supervisor", "agente"] as const) {
  test(`legacy per-conversation AI toggle always denied for ${role}`, async () => {
    const h = harness(role);
    await assert.rejects(h.actions.setWhatsAppConversationAiState(new FormData() as never), /se controla desde Operación/);
    assert.equal(h.reads(), 0);
    assert.deepEqual(h.writes, []);
  });
}

for (const [name, input] of actionCases) {
  test(`${name}: missing automation configuration is not an authorized general pause`, async () => {
    const h = harness("agente", agentId, "auto", null);
    await assert.rejects(h.actions[name](input as never), /No hay una configuración de IA válida/);
    assert.deepEqual(h.writes, []);
    assert.equal(h.providerCalls(), 0);
  });
  test(`${name}: agent cannot take over an AI-owned conversation`, async () => {
    const h = harness("agente", agentId, "auto", true);
    await assert.rejects(h.actions[name](input as never), /Espera la derivación/);
    assert.deepEqual(h.writes, []);
    assert.equal(h.providerCalls(), 0);
  });
  test(`${name}: general automation off permits assigned human attention`, async () => {
    const h = harness("agente", agentId, "auto", false);
    await h.actions[name](input as never);
    assert.ok(h.writes.length > 0);
  });
}

test("global automation is denied for agents and invalid input; admin/supervisor call scoped transaction", async () => {
  const form = new FormData();
  form.set("enabled", "false");
  const agent = harness("agente");
  await assert.rejects(agent.actions.setWhatsAppAutomationEnabled(form as never), /role_denied/);
  assert.equal(agent.reads(), 0);
  assert.deepEqual(agent.writes, []);
  for (const role of ["admin", "supervisor"] as const) {
    const h = harness(role);
    await assert.rejects(h.actions.setWhatsAppAutomationEnabled(new FormData() as never), /modo de automatización válido/);
    assert.deepEqual(h.writes, []);
    await h.actions.setWhatsAppAutomationEnabled(form as never);
    assert.deepEqual(h.writes, ["rpc:set_whatsapp_automation_enabled"]);
  }
});

test("solo el agente puede solicitar la toma auditable de su conversación", async () => {
  const form = new FormData();
  form.set("conversation_id", conversationId);
  const agent = harness("agente", agentId, "auto", true);
  await agent.actions.takeOverWhatsAppConversation(form as never);
  assert.deepEqual(agent.writes, ["rpc:take_over_whatsapp_conversation"]);

  for (const role of ["admin", "supervisor"] as const) {
    const h = harness(role, agentId, "auto", true);
    await assert.rejects(h.actions.takeOverWhatsAppConversation(form as never), /role_denied/);
    assert.deepEqual(h.writes, []);
  }
});
