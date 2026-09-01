import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { LOOP_ACTION_LABELS } from "../src/lib/ai-learning-loop.ts";
import { verifyIntegrationV2WorkerAuthorization } from "../src/lib/integration-v2.ts";

const nodeRequire = createRequire(import.meta.url);
type Props = Record<string, unknown> & { children?: React.ReactNode };
type Row = Record<string, unknown>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function element(tag: string) {
  return function SemanticElement({ children, ...props }: Props) {
    return React.createElement(tag, Object.fromEntries(Object.entries(props).filter(([key]) =>
      ["name", "value", "defaultValue", "required", "disabled", "type", "href", "minLength", "maxLength"].includes(key))), children);
  };
}
const ui = {
  SectionCard: ({ title, children }: Props) => React.createElement("section", null, React.createElement("h2", null, title as React.ReactNode), children),
  MetricCard: ({ label, value }: Props) => React.createElement("div", null, `${label}: ${value}`),
  Field: ({ label, children }: Props) => React.createElement("label", null, label as React.ReactNode, children),
  Select: element("select"), Input: element("input"), Button: element("button"), Callout: element("aside"), Badge: element("span"),
};
function load(path: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module: loadedModule, exports: loadedModule.exports,
    console, Date, URLSearchParams, process: { env },
    require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
  }, { filename: path });
  return loadedModule.exports;
}

async function renderLoop({ role = "supervisor", fail = "", stale = false, params = { run: id(901) } }: {
  role?: string; fail?: string; stale?: boolean; params?: Record<string, string>;
} = {}) {
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const tables: Record<string, Row[]> = {
    ai_loop_runs: [{ id: id(901), lead_id: id(301), recording_id: id(601), campaign_id: id(101), status: "completed", source_hash: "a".repeat(32), policy_version: "callback-v1",
      created_at: new Date().toISOString(), expires_at: new Date(Date.now()+3600000).toISOString(), superseded_at: stale ? new Date().toISOString() : null,
      review_version: 0, review: null, error_code: null,
      analysis: { uncertain: false, facts: [{ kind: "callback_request", quote: "Por favor llámeme el viernes.", speaker: "customer", requested_time_text: "el viernes" }] },
      decision: { action: "callback_candidate", reason: "Solicitud explícita", memory_ids: [] } }],
    ai_loop_campaign_configs: [{ campaign_id: id(101), mode: "off", daily_attempt_limit: 20 }],
    ai_loop_feedback: [{ id: id(801), run_id: id(901), created_at: new Date().toISOString(), kind: "human_review", payload: { note: "Revisión fixture" } }],
    call_transcriptions: [{ recording_id: id(601), status: "completed", transcript_text: "Cliente: Por favor llámeme el viernes. Agente: Gracias." }],
  };
  const client = {
    async rpc(name: string) { assert.equal(name, "get_report_scope_campaigns"); return { data: [{ id: id(101), name: "Campaña fixture" }], error: null }; },
    from(table: string) {
      assert.ok(Object.hasOwn(tables, table), `unexpected access ${table}`);
      const read = { table, filters: [] as Array<[string, unknown]> }; reads.push(read);
      let one = false;
      const query = {
        select: () => query, order: () => query, range: () => query, limit: () => query,
        eq(key: string, value: unknown) { read.filters.push([key, value]); return query; },
        maybeSingle() { one = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          const rows = tables[table].filter((row) => read.filters.every(([key, value]) => row[key] === value));
          return Promise.resolve(fail === table ? { data: null, error: { message: "fixture failure" } } : { data: one ? rows[0] : rows, count: rows.length, error: null }).then(resolve);
        },
      }; return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireProfile: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("role_denied"); return { role }; } },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/ai-learning-loop": { LOOP_ACTION_LABELS },
    "@/components/ui": ui,
    "next/link": { __esModule: true, default: element("a") },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/app/actions/ai-learning-loop": new Proxy({}, { get() { return () => { throw new Error("render must never mutate"); }; } }),
    "@/components/recording-audio-player": { RecordingAudioPlayer: ({ recordingId }: { recordingId: string }) => React.createElement("button", { "data-recording": recordingId }, "Escuchar") },
  };
  dependencies["@/components/learning-loop-review"] = load("../src/components/learning-loop-review.tsx", dependencies);
  const page = load("../src/app/dashboard/calidad/loop/page.tsx", dependencies).default as (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
  return { html: renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) })), reads };
}

test("loop render: supervisor gets separate review inputs and the original source for a deep-linked run", async () => {
  const { html, reads } = await renderLoop({ params: { run: id(901), page: "999" } });
  assert.match(html, /name="recommendation"/);
  assert.match(html, /name="extraction"/);
  assert.match(html, /Guardar revisión/);
  assert.match(html, /No se ha|no agenda ni origina/);
  assert.match(html, /Ver transcripción actual/);
  assert.match(html, /Cliente: Por favor/);
  assert.match(html, /data-recording="00000000-0000-4000-8000-000000000601"/);
  assert.doesNotMatch(html, /name="mode"|Guardar configuración/);
  assert.deepEqual(reads.find((read) => read.table === "ai_loop_runs")?.filters, [["id", id(901)]]);
  assert.deepEqual(reads.find((read) => read.table === "call_transcriptions")?.filters, [["recording_id", id(601)]]);
});

test("loop render: admin configuration defaults to off; list never loads transcript content", async () => {
  const { html, reads } = await renderLoop({ role: "admin", params: { campaign: id(101) } });
  assert.match(html, /name="mode"/);
  assert.match(html, /value="off" selected/);
  assert.match(html, /procesamiento IA está apagado/);
  assert.equal(reads.some((read) => read.table === "call_transcriptions"), false);
  assert.equal(reads.some((read) => read.table === "ai_loop_feedback"), false);
});

test("loop render: stale recommendations cannot be accepted; failed reads do not show partial results", async () => {
  assert.doesNotMatch((await renderLoop({ stale: true })).html, /name="recommendation"|Guardar revisión/);
  const { html } = await renderLoop({ fail: "ai_loop_feedback" });
  assert.match(html, /No se pudo consultar el loop completo/);
  assert.doesNotMatch(html, /name="recommendation"|Versiones en el alcance|Por favor/);
  await assert.rejects(renderLoop({ role: "agente" }), /role_denied/);
});

test("360 memory renders a withdrawal control and tolerates a not-yet-applied migration", async () => {
  let missing = false;
  const dependencies: Record<string, unknown> = {
    "@/components/ui": ui,
    "next/link": { __esModule: true, default: element("a") },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/app/actions/ai-learning-loop": {},
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name: string) => {
      assert.equal(name, "get_ai_loop_memory");
      return missing ? { error: { code: "PGRST202" } } : { data: [{ id: id(801), run_id: id(901), quote: "Hecho confirmado" }], error: null };
    } }) },
  };
  dependencies["@/components/learning-loop-review"] = load("../src/components/learning-loop-review.tsx", dependencies);
  const panel = load("../src/components/learning-memory-panel.tsx", dependencies).LearningMemoryPanel as (props: { leadId: string }) => Promise<React.ReactElement>;
  const html = renderToStaticMarkup(await panel({ leadId: id(301) }));
  assert.match(html, /Hecho confirmado|Retirar de la memoria/);
  assert.match(html, /aunque|incluso si la decisión original venció/);
  missing = true;
  assert.equal(await panel({ leadId: id(301) }), null);
});

test("worker HTTP: no session required, but missing/wrong Bearer cannot reach the database", async () => {
  let connects = 0;
  const env = { AI_LOOP_WORKER_SECRET: "s".repeat(40), AI_LOOP_ENABLED: "false", INCEPTION_API_KEY: "fixture" };
  const dependencies = {
    "next/server": { NextResponse: { json: (body: unknown, init?: { status: number }) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/supabase/admin": { createAdminClient: () => { connects++; return { rpc: async () => ({ data: 0, error: null }) }; } },
    "@/lib/integration-v2": { verifyIntegrationV2WorkerAuthorization },
    "@/lib/ai-learning-loop-worker": { processLearningLoop: async () => ({ completed: 1 }), extractConversationFacts: () => { throw new Error("no provider in fixture"); } },
  };
  const route = load("../src/app/api/ai/learning-loop/worker/route.ts", dependencies, env).GET as (request: unknown) => Promise<{ status: number; body: Row }>;
  const request = (bearer: string | null) => ({ headers: { get: () => bearer } });
  assert.equal((await route(request(null))).status, 401);
  assert.equal((await route(request("Bearer wrong"))).status, 401);
  assert.equal((await route(request(`Bearer ${env.AI_LOOP_WORKER_SECRET}`))).body.status, "disabled");
  assert.equal(connects, 0);
  env.AI_LOOP_ENABLED = "true";
  assert.equal((await route(request(`Bearer ${env.AI_LOOP_WORKER_SECRET}`))).body.completed, 1);
  assert.equal(connects, 1);
});

test("middleware exempts exactly the machine endpoints, never adjacent routes", async () => {
  let authCalls = 0;
  const dependencies = {
    "@supabase/ssr": { createServerClient: () => ({ auth: { getUser: async () => { authCalls++; return { data: { user: null } }; } } }) },
    "next/server": { NextResponse: { next: () => ({ cookies: { getAll: () => [] }, kind: "next" }), redirect: () => ({ cookies: { set() {} }, kind: "redirect" }) } },
  };
  const update = load("../src/lib/supabase/middleware.ts", dependencies).updateSession as (request: unknown) => Promise<{ kind: string }>;
  const request = (pathname: string) => ({ nextUrl: { pathname, clone: () => new URL(`http://localhost${pathname}`) } });
  assert.equal((await update(request("/api/ai/learning-loop/worker"))).kind, "next");
  assert.equal((await update(request("/api/integrations/meta/whatsapp/ai-worker"))).kind, "next");
  assert.equal((await update(request("/api/integrations/meta/whatsapp/timeouts"))).kind, "next");
  assert.equal(authCalls, 0);
  assert.equal((await update(request("/api/ai/learning-loop/worker-extra"))).kind, "redirect");
  assert.equal((await update(request("/api/integrations/meta/whatsapp/ai-worker-extra"))).kind, "redirect");
  assert.equal((await update(request("/dashboard/calidad/loop"))).kind, "redirect");
  assert.equal(authCalls, 3);
});
