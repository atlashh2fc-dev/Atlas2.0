import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const ids = {
  campaign: "00000000-0000-4000-8000-000000000101",
  otherCampaign: "00000000-0000-4000-8000-000000000102",
  queue: "00000000-0000-4000-8000-000000000201",
  agent: "00000000-0000-4000-8000-000000000301",
};
type Row = Record<string, unknown>;
type Props = Record<string, unknown> & { children?: React.ReactNode };
type Read = { table: string; columns?: string; predicates: [string, unknown][] };

// Preserve semantic HTML for the render assertions. These stubs remove only UI
// styling/client behavior; OperationsPage, model and stock loader execute real code.
function element(tag: string) {
  return function SemanticElement({ children, className, ...props }: Props) {
    const htmlProps = Object.fromEntries(Object.entries(props).filter(([key]) =>
      ["name", "value", "defaultValue", "required", "disabled", "type", "colSpan", "href", "action"].includes(key)));
    return React.createElement(tag, { ...htmlProps, className }, children);
  };
}
function section({ title, description, children }: Props) {
  return React.createElement("section", null,
    React.createElement("h2", null, title as React.ReactNode),
    Boolean(description) && React.createElement("p", null, description as React.ReactNode), children);
}
const ui = {
  PageHeader: ({ title, description, actions }: Props) => React.createElement("header", null,
    React.createElement("h1", null, title as React.ReactNode),
    React.createElement("p", null, description as React.ReactNode), actions as React.ReactNode),
  SectionCard: section,
  Card: element("div"), Badge: element("span"), Callout: element("aside"),
  Select: element("select"), Table: element("table"), Tbody: element("tbody"),
  Td: element("td"), Th: element("th"), Tr: element("tr"),
  Thead: ({ children }: Props) => React.createElement("thead", null, React.createElement("tr", null, children)),
  TableEmpty: ({ colSpan, children }: Props) => React.createElement("tr", null,
    React.createElement("td", { colSpan: colSpan as number }, children)),
  ActionForm: ({ children }: Props) => React.createElement("form", { "data-action": "general-automation" }, children),
  ActionSubmit: element("button"), buttonClasses: () => "button",
};

async function renderOperations({
  role = "admin",
  params = {},
  failures = [],
  empty = false,
}: {
  role?: "admin" | "supervisor" | "agente";
  params?: Record<string, string>;
  failures?: string[];
  empty?: boolean;
} = {}) {
  const reads: Read[] = [];
  let connections = 0;
  const tables: Record<string, Row[]> = {
    contact_center_queues: [{ id: ids.queue, name: "Atención digital", is_active: true, routing_mode: "least_loaded", max_concurrent_per_agent: 10, service_level_seconds: 60 }],
    contact_center_queue_sources: [
      { queue_id: ids.queue, campaign_id: ids.campaign, channel_type: "whatsapp", is_active: true, whatsapp_campaign_routes: { whatsapp_channels: { status: "active" } } },
      { queue_id: ids.queue, campaign_id: ids.campaign, channel_type: "voice", is_active: true, whatsapp_campaign_routes: null },
      { queue_id: ids.queue, campaign_id: ids.campaign, channel_type: "email", is_active: true, whatsapp_campaign_routes: null },
    ],
    contact_center_queue_members: [{ queue_id: ids.queue, profile_id: ids.agent, is_active: true, max_concurrent: 10, profiles: { id: ids.agent, full_name: "Ejecutivo autorizado", active: true } }],
    campaigns: [{ id: ids.campaign, name: "Campaña autorizada" }, { id: ids.otherCampaign, name: "Segunda campaña autorizada" }],
    whatsapp_ai_configs: [{ campaign_id: ids.campaign, enabled: true }, { campaign_id: ids.otherCampaign, enabled: false }],
    whatsapp_automation_changes: [],
    whatsapp_conversations: [{ id: "conversation-meta", queue_id: ids.queue, campaign_id: ids.campaign, assigned_to: ids.agent, status: "open", last_inbound_at: "2026-08-27T10:00:00Z", last_outbound_at: null, last_message_at: "2026-08-27T10:00:00Z",
      // Sentinels deliberately present even though the real projection excludes them.
      contact_name: "PRIVATE-CUSTOMER-NAME", contact_phone: "+56999888777", text_body: "PRIVATE-TRANSCRIPT-BODY" }],
  };
  const rpcRows: Record<string, Row[]> = {
    get_queue_health: [{ campaign_id: ids.campaign, campaign_name: "Campaña autorizada", queue_name: "voice-queue", campaign_type: "outbound", in_flight: 2, attempts_today: 6, answered_today: 3, completed_today: 2 }],
    get_agent_live_status: [{ profile_id: ids.agent, full_name: "Ejecutivo autorizado", campaign_id: ids.campaign, campaign_name: "Campaña autorizada", phone_status: "available", is_pause: false, reason_code: "disponible" }],
    get_mail_engagement_report_read_model: [{ mail_campaign_id: "mail-1", mail_campaign_name: "Correo autorizado", campaign_id: ids.campaign, campaign_name: "Campaña autorizada", sent_leads: 20, opened_leads: 8, clicked_leads: 2, hot_leads: 8, assigned_hot_leads: 3, managed_hot_leads: 1 }],
  };
  const client = {
    from(table: string) {
      assert.ok(table in tables, `Unexpected data access: ${table}`);
      const read: Read = { table, predicates: [] };
      reads.push(read);
      let range: [number, number] | null = null;
      const query = {
        select(columns: string) { read.columns = columns; return query; },
        order: () => query,
        limit: () => query,
        eq(field: string, value: unknown) { read.predicates.push([field, value]); return query; },
        in: () => query,
        range(from: number, to: number) { range = [from, to]; return query; },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const rows = (empty ? [] : tables[table]).filter((row) => read.predicates.every(([field, value]) => row[field] === value));
          const result = failures.includes(table)
            ? { data: null, count: null, error: { message: "Fixture query unavailable" } }
            : { data: range ? rows.slice(range[0], range[1] + 1) : rows, count: rows.length, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string) {
      assert.ok(name in rpcRows, `Unexpected RPC mutation/access: ${name}`);
      return failures.includes(name)
        ? { data: null, error: { message: "Fixture RPC unavailable" } }
        : { data: empty ? [] : rpcRows[name], error: null };
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/link": { __esModule: true, default: element("a") },
    "next/navigation": { redirect(path: string) { throw new Error(`redirect:${path}`); } },
    "@/components/ui": ui,
    "@/components/operations-refresh": { OperationsRefresh: () => React.createElement("span", null, "Actualización manual") },
    "@/app/actions/whatsapp": { setWhatsAppAutomationEnabled: () => { throw new Error("Render must never mutate automation"); } },
    "@/lib/auth": { requireProfile: async (allowed: string[]) => {
      if (!allowed.includes(role)) throw new Error("role_denied");
      return { id: "profile", role, active: true };
    } },
    "@/lib/supabase/server": { createClient: async () => { connections++; return client; } },
    "server-only": {},
  };
  function load(path: string): Record<string, unknown> {
    const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const loadedModule = { exports: {} };
    vm.runInNewContext(compiled.outputText, {
      module: loadedModule, exports: loadedModule.exports, console, Date,
      require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
    }, { filename: path });
    return loadedModule.exports;
  }
  dependencies["@/lib/workspace-permissions"] = load("../src/lib/workspace-permissions.ts");
  dependencies["@/lib/operations-model"] = load("../src/lib/operations-model.ts");
  dependencies["@/lib/operations-data"] = load("../src/lib/operations-data.ts");
  const page = load("../src/app/dashboard/operacion/page.tsx").default as (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));
  return { html, reads, connections };
}

test("real admin Operations render contains queue metadata and no customer inbox or content", async () => {
  const { html, reads } = await renderOperations();
  assert.match(html, /Centro de operaciones/);
  assert.match(html, /Administración sin atención al cliente/);
  assert.match(html, /Atención digital/);
  assert.match(html, /Configurar colas/);
  assert.match(html, /Correo · Operación actual/);
  assert.match(html, /Gestionar correo/);
  assert.doesNotMatch(html, /PRIVATE-CUSTOMER|PRIVATE-TRANSCRIPT|56999888777|<textarea|href="\/dashboard\/conversaciones/);
  assert.doesNotMatch(html, />Enviar<|>Responder<|Marcar leída/);
  const stockRead = reads.find((read) => read.table === "whatsapp_conversations");
  assert.ok(stockRead);
  assert.doesNotMatch(stockRead.columns!, /text_body|contact_name|contact_phone|notes/);
  assert.equal(reads.some((read) => read.table === "whatsapp_messages"), false);
});

test("real supervisor render describes authorized scope and does not offer configuration", async () => {
  const { html } = await renderOperations({ role: "supervisor" });
  assert.match(html, /Control de tus equipos y campañas autorizadas/);
  assert.match(html, /dentro de tu alcance autorizado/);
  assert.match(html, /Supervisar asignaciones/);
  assert.doesNotMatch(html, /href="\/dashboard\/admin|Configurar colas|PRIVATE-CUSTOMER|<textarea/);
});

test("general automation remains outside monitor filters, even for a Voice-only campaign view", async () => {
  const { html, reads } = await renderOperations({ params: { channel: "voice", campaign: ids.campaign } });
  assert.match(html, /Automatización general de WhatsApp/);
  assert.match(html, /1 de 2 campañas con automatización activa/);
  assert.match(html, /no se limita por los filtros del monitor/);
  assert.doesNotMatch(html, /WhatsApp · Stock actual/);
  const automationForm = html.match(/<form data-action="general-automation">([\s\S]*?)<\/form>/)?.[1];
  assert.ok(automationForm);
  assert.match(automationForm, /name="enabled"/);
  assert.doesNotMatch(automationForm, /name="(?:campaign|queue|channel|conversation_id|agent_id)"/);
  assert.equal((html.match(/data-action="general-automation"/g) ?? []).length, 1);
  const monitorForm = html.match(/<form\b(?=[^>]*action="\/dashboard\/operacion")[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(monitorForm);
  assert.doesNotMatch(monitorForm, /name="enabled"|general-automation/);
  assert.equal(reads.find((read) => read.table === "whatsapp_ai_configs")?.predicates.length, 0);
  assert.equal(reads.some((read) => read.table === "whatsapp_conversations"), false);
});

test("correo usa sólo colas coincidentes y deriva la carga al espacio de asignación", async () => {
  const active = await renderOperations({ params: { channel: "email", state: "active" } });
  assert.match(active.html, /Correo · Operación actual/);
  assert.match(active.html, /Correo autorizado/);
  assert.match(active.html, /La carga y asignación por ejecutivo se administra en/);
  assert.match(active.html, /href="\/dashboard\/mail"/);
  assert.doesNotMatch(active.html, /WhatsApp · Stock actual|Campañas y colas de voz/);
  assert.equal(active.reads.some((read) => read.table === "whatsapp_conversations"), false);

  const inactive = await renderOperations({ params: { channel: "email", state: "inactive" } });
  assert.match(inactive.html, /No hay campañas de correo conectadas que coincidan/);
  assert.doesNotMatch(inactive.html, /Correo autorizado|Gestionar correo/);
});

test("query failures render unavailable metrics, not false zero or an active automation control", async () => {
  const { html } = await renderOperations({ failures: ["whatsapp_conversations", "get_queue_health", "get_agent_live_status", "get_mail_engagement_report_read_model", "whatsapp_ai_configs", "whatsapp_automation_changes"] });
  assert.match(html, /No fue posible consultar el stock de WhatsApp/);
  assert.match(html, /Datos de voz no disponibles/);
  assert.match(html, /No se pudo consultar la presencia de voz/);
  assert.match(html, /No fue posible consultar la operación de correo/);
  assert.match(html, /el control está deshabilitado/);
  assert.doesNotMatch(html, /data-action="general-automation"/);
  const metrics = [...html.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((match) => match[1]);
  assert.ok(metrics.length >= 8);
  assert.ok(metrics.every((value) => value === "No disponible"), `Unexpected failure metrics: ${metrics.join(", ")}`);
});

test("an empty successful result is explicitly different from failed data", async () => {
  const { html } = await renderOperations({ empty: true });
  assert.match(html, /Sin configurar/);
  assert.match(html, /No hay colas de WhatsApp que coincidan/);
  assert.match(html, /No hay campañas activas de voz que coincidan/);
  assert.match(html, /No hay campañas de correo conectadas que coincidan/);
  assert.match(html, /<dd[^>]*>0<\/dd>/);
  assert.doesNotMatch(html, /el control está deshabilitado|No fue posible consultar el stock/);
});

test("an agent cannot render the management route", async () => {
  await assert.rejects(renderOperations({ role: "agente" }), /role_denied/);
});
