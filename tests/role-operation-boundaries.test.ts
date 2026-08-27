import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { AppRole } from "../src/lib/types.ts";

const nodeRequire = createRequire(import.meta.url);
const agentId = "agent-own";

function harness(role: AppRole, owner: string | null = agentId, manager: string | null = null) {
  let connections = 0;
  const mutations: string[] = [];
  const filters: unknown[][] = [];
  const client = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => { filters.push(args); return query; },
        not: () => query, order: () => query, limit: () => query,
        insert: () => { mutations.push(`insert:${table}`); return query; },
        update: () => { mutations.push(`update:${table}`); return query; },
        maybeSingle: async () => ({ data: { id: "lead", assigned_to: owner, managed_by: manager }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    },
    rpc: async (name: string) => { mutations.push(`rpc:${name}`); return { data: null, error: null }; },
  };
  const profile = { id: agentId, role, active: true };
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": {
      requireProfile: async (allowed?: AppRole[]) => {
        if (allowed && !allowed.includes(role)) throw new Error("role_denied");
        return profile;
      },
      getCurrentProfile: async () => profile,
    },
    "@/lib/supabase/server": { createClient: async () => { connections++; return client; } },
    "@/lib/supabase/admin": { createAdminClient: () => { connections++; return client; } },
    "next/cache": { revalidatePath() {} },
  };
  function load(path: string) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const testModule = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
    vm.runInNewContext(compiled.outputText, {
      module: testModule, exports: testModule.exports, console, Date,
      require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
    }, { filename: path });
    return testModule.exports;
  }
  return { load, mutations, filters, connections: () => connections };
}

for (const role of ["admin", "supervisor"] as const) {
  for (const [path, action, args] of [
    ["../src/app/actions/agent-sip.ts", "getMySipCredentials", []],
    ["../src/app/actions/agent-sip.ts", "listMyDialerContacts", []],
    ["../src/app/actions/agent-status.ts", "heartbeat", []],
    ["../src/app/actions/agent-status.ts", "getMyCurrentStatus", []],
    ["../src/app/actions/agent-status.ts", "setMyCurrentStatus", ["available"]],
    ["../src/app/actions/leads.ts", "registerInteraction", [new FormData()]],
  ] as const) {
    test(`${role} cannot execute operator action ${action}, even through a direct invocation`, async () => {
      const state = harness(role);
      await assert.rejects(state.load(path)[action](...args), /role_denied/);
      assert.equal(state.connections(), 0);
      assert.equal(state.mutations.length, 0);
    });
  }

  test(`${role} logout does not modify agent availability`, async () => {
    const state = harness(role);
    await state.load("../src/app/actions/agent-status.ts").markAgentLoggedOut();
    assert.equal(state.connections(), 0);
    assert.equal(state.mutations.length, 0);
  });
}

for (const owner of [null, "other-agent"]) {
  test(`an agent cannot record an interaction for ${owner ?? "unassigned"} ownership`, async () => {
    const state = harness("agente", owner);
    const form = new FormData();
    form.set("lead_id", "lead");
    form.set("result", "sale");
    form.set("new_status", "sale");
    await assert.rejects(state.load("../src/app/actions/leads.ts").registerInteraction(form), /ejecutivo responsable/);
    assert.equal(state.mutations.length, 0);
  });
}

test("the assigned agent retains interaction recording and availability", async () => {
  const state = harness("agente");
  const form = new FormData();
  form.set("lead_id", "lead");
  form.set("result", "contacted");
  await state.load("../src/app/actions/leads.ts").registerInteraction(form);
  await state.load("../src/app/actions/agent-status.ts").heartbeat();
  assert.deepEqual(state.mutations, ["insert:interactions", "update:agent_current_status"]);
});

test("the dialer contact list is always scoped to its agent", async () => {
  const state = harness("agente");
  await state.load("../src/app/actions/agent-sip.ts").listMyDialerContacts();
  assert.ok(state.filters.some(([field, value]) => field === "assigned_to" && value === agentId));
});

test("the application shell does not mount operator services in management workspaces", () => {
  const source = readFileSync(new URL("../src/app/dashboard/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /canAttendCustomers && <DialerListener/);
  assert.match(source, /canAttendCustomers && <CtiBar/);
  const agenda = readFileSync(new URL("../src/app/dashboard/agenda/page.tsx", import.meta.url), "utf8");
  assert.match(agenda, /requireProfile\(\["agente"\]\)/);
  const detail = readFileSync(new URL("../src/app/dashboard/leads/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /permissions.canReadConversationContent \? supabase\s*\.from\("whatsapp_messages"\)/);
});
