import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatOperationalAge,
  isAwaitingResponse,
  parseOperationFilters,
  summarizeConversationStock,
  type OperationalConversation,
} from "../src/lib/operations-model.ts";

const conversation: OperationalConversation = {
  id: "one",
  queue_id: "queue",
  campaign_id: "campaign",
  assigned_to: "agent",
  status: "open",
  last_inbound_at: "2026-08-27T10:00:00Z",
  last_outbound_at: "2026-08-27T09:00:00Z",
  last_message_at: "2026-08-27T10:00:00Z",
};

test("espera se deriva de dirección y tiempo, nunca de no leídos", () => {
  assert.equal(isAwaitingResponse(conversation), true);
  assert.equal(
    isAwaitingResponse({ ...conversation, last_outbound_at: null }),
    true,
  );
  assert.equal(
    isAwaitingResponse({
      ...conversation,
      last_outbound_at: conversation.last_inbound_at,
    }),
    false,
  );
  assert.equal(
    isAwaitingResponse({
      ...conversation,
      last_outbound_at: "2026-08-27T11:00:00Z",
    }),
    false,
  );
  assert.equal(
    isAwaitingResponse({ ...conversation, last_inbound_at: null }),
    false,
  );
  assert.equal(
    isAwaitingResponse({ ...conversation, last_inbound_at: "invalid" }),
    false,
  );
  assert.equal(
    isAwaitingResponse({ ...conversation, status: "closed" }),
    false,
  );
});

test("stock separa sin cerrar, sin asignar y sin respuesta sin inventar ocupación", () => {
  assert.deepEqual(
    summarizeConversationStock([
      conversation,
      {
        ...conversation,
        id: "two",
        status: "pending",
        assigned_to: null,
        last_inbound_at: "2026-08-27T08:00:00Z",
        last_outbound_at: null,
      },
      { ...conversation, id: "three", status: "closed" },
    ]),
    {
      total: 2,
      open: 1,
      pending: 1,
      unassigned: 1,
      awaitingResponse: 2,
      oldestUnansweredAt: "2026-08-27T08:00:00Z",
    },
  );
  assert.deepEqual(summarizeConversationStock([]), {
    total: 0,
    open: 0,
    pending: 0,
    unassigned: 0,
    awaitingResponse: 0,
    oldestUnansweredAt: null,
  });
});

test("filtros validados y antigüedad explícita", () => {
  assert.deepEqual(
    parseOperationFilters({
      channel: ["voice"],
      campaign: "bad",
      state: "bad",
      queue: "bad",
    }),
    { channel: "all", campaign: "", state: "all", queue: "" },
  );
  assert.equal(
    parseOperationFilters({ channel: "whatsapp", state: "inactive" }).channel,
    "whatsapp",
  );
  assert.equal(formatOperationalAge(null, Date.now()), "—");
  assert.equal(
    formatOperationalAge(
      "2026-08-27T10:00:00Z",
      Date.parse("2026-08-27T11:30:00Z"),
    ),
    "1 h 30 min",
  );
});

// El puesto de atención ahora tiene una pestaña por canal: el guardia de
// permisos vive en el layout y la bandeja de WhatsApp en su propia ruta.
const attentionLayout = readFileSync(
  new URL("../src/app/dashboard/conversaciones/layout.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const inbox = readFileSync(
  new URL("../src/app/dashboard/conversaciones/whatsapp/page.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const monitor = readFileSync(
  new URL("../src/app/dashboard/operacion/page.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const loader = readFileSync(
  new URL("../src/lib/operations-data.ts", import.meta.url),
  "utf8",
);

test("administración redirige antes de consultar conversaciones y no hay selección automática", () => {
  // El layout envuelve a todas las pestañas, así que su redirección corre
  // antes que cualquier consulta de conversaciones de sus hijos.
  assert.match(
    attentionLayout,
    /if \(!permissions\.canReadConversationContent\) redirect\("\/dashboard\/operacion"\)/,
  );
  assert.doesNotMatch(attentionLayout, /whatsapp_conversations/);
  assert.doesNotMatch(inbox, /conversations\[0\]/);
  assert.match(
    inbox,
    /permissions\.canAttendCustomers\) conversationQuery = conversationQuery\.eq\("assigned_to", profile\.id\)/,
  );
  assert.match(
    inbox,
    /permissions\.canAttendCustomers \? \( <div className="border-t/,
  );
  assert.match(
    inbox,
    /permissions\.canAttendCustomers && humanAttentionReady && selected\.unread_count/,
  );
});

test("monitor no consulta ni muta contenido; errores y truncamiento no son cero", () => {
  assert.doesNotMatch(
    loader + monitor,
    /\.from\("whatsapp_messages"\)|text_body|close_note|provider_payload|createAdminClient|\.update\(|\.insert\(/,
  );
  assert.match(loader, /count: "exact"/);
  assert.match(loader, /result\.count > MAX_ROWS/);
  assert.match(loader, /data: null/);
  assert.match(monitor, /stockUnavailable \? null/);
  assert.match(monitor, /Espera ACD en vivo/);
});

test("el modo general sigue centralizado y el agente tiene una toma de atención explícita", () => {
  assert.doesNotMatch(
    inbox,
    /setWhatsAppConversationAiState|Tomar control|Reactivar IA/,
  );
  assert.match(inbox, /takeOverWhatsAppConversation/);
  assert.match(inbox, /Tomar atención/);
  assert.match(monitor, /action=\{setWhatsAppAutomationEnabled\}/);
  assert.match(monitor, /name="enabled"/);
  assert.match(monitor, /Confirmo el cambio/);
  assert.match(monitor, /Activarla no retoma conversaciones ya transferidas/);
});

test("configuración de cola admin no ofrece transcripciones ni duplica atención", () => {
  const configuration = readFileSync(
    new URL("../src/app/dashboard/admin/colas/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    configuration,
    /\/dashboard\/conversaciones|\.from\("whatsapp_conversations"\)|get_contact_center_queue_control|assignWhatsAppConversation|Agentes disponibles|Fuera de SLA|Abrir escritorio/,
  );
  assert.match(configuration, /\/dashboard\/operacion\?queue=/);
  assert.match(configuration, /\/enrutamiento/);
  assert.match(configuration, /\/miembros/);
  assert.match(configuration, /\/fuentes/);
});

test("listado de configuración conserva semántica del stock y errores explícitos", () => {
  const listing = readFileSync(
    new URL("../src/app/dashboard/admin/colas/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(listing, /<Th[^>]*>En cola|<Th>SLA/);
  assert.match(listing, /WhatsApp sin cerrar/);
  assert.match(listing, /stockUnavailable\s+\? "No disponible"/);
  assert.match(listing, /loadOperationalConversations/);
  assert.match(listing, /no es el catálogo completo de campañas/);
  assert.match(listing, /Una cola puede estar todavía sin fuentes/);
});
