import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as replySchema from "../src/lib/mercury-whatsapp-schema.ts";
import * as conversationMemory from "../src/lib/whatsapp-conversation-memory.ts";

const nodeRequire = createRequire(import.meta.url);

async function runAutomation(options: {
  initialState?: string; initialEnabled?: boolean; currentEnabled?: boolean;
  currentState?: string; controlError?: boolean; dispatchEnabled?: boolean;
  dispatchState?: string; handoff?: boolean; newerMessageAtDispatch?: boolean;
  newerMessageBeforePrepared?: boolean; finished?: boolean; newerMessageAfterSend?: boolean;
  inboundText?: string; automaticAppointmentBooking?: boolean;
  previousOutboundText?: string;
  generatedHandoffKind?: "none" | "human_requested" | "appointment" | "quote" | "unknown" | "complaint";
  generatedAppointmentAt?: string | null;
  modelFailure?: boolean;
  memorySummary?: string;
  resumeExpiredHandoff?: boolean;
  oldAppointmentContext?: boolean;
} = {}) {
  let providerCalls = 0;
  const sentBodies: string[] = [];
  const completionBodies: string[] = [];
  let generatedCalls = 0;
  let configReads = 0;
  let conversationReads = 0;
  let latestMessageId = "inbound";
  let handoffCompleted = false;
  let closeCalls = 0;
  const rpcCalls: string[] = [];
  const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string) {
      rpcCalls.push(name);
      if (name === "resume_expired_whatsapp_ai_handoff") {
        return { data: options.resumeExpiredHandoff ?? false, error: null };
      }
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
            automatic_appointment_booking: options.automaticAppointmentBooking ?? true,
          }, error: configReads > 1 && options.controlError ? { message: "unavailable" } : null };
        }
        if (table === "whatsapp_messages") {
          const message = { id: "inbound", direction: "inbound", message_type: "text", text_body: options.finished ? "no gracias" : options.inboundText ?? "¿Qué servicios ofrecen?", sent_by: null, created_at: "2026-08-27T15:00:00Z" };
          const previousOutbound = { id: "outbound-before", direction: "outbound", message_type: "text", text_body: options.previousOutboundText, sent_by: null, created_at: "2026-08-27T14:59:00Z" };
          const resumedGreeting = { id: "resumed-greeting", direction: "outbound", message_type: "text", text_body: "¡Hola! Qué gusto leerte nuevamente. ¿En qué puedo ayudarte hoy?", sent_by: null, created_at: "2026-08-27T14:58:00Z" };
          const greetingInbound = { id: "greeting-inbound", direction: "inbound", message_type: "text", text_body: "Hola", sent_by: null, created_at: "2026-08-27T14:57:00Z" };
          const oldAppointment = { id: "old-appointment", direction: "outbound", message_type: "text", text_body: "Agendaremos la llamada antigua para mañana a las 12:00.", sent_by: null, created_at: "2026-08-20T14:00:00Z" };
          const latestId = (conversationReads >= 3 && (options.newerMessageAtDispatch
            || (options.newerMessageBeforePrepared && excludedId === latestMessageId)))
            || (providerCalls > 0 && options.newerMessageAfterSend) ? "new-inbound"
              : excludedId === latestMessageId ? "inbound" : latestMessageId;
          return { data: columns.includes("created_at")
            ? options.oldAppointmentContext
              ? [message, resumedGreeting, greetingInbound, oldAppointment]
              : options.previousOutboundText ? [message, previousOutbound] : [message]
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
    "./whatsapp-conversation-memory.ts": {
      ...conversationMemory,
      loadWhatsAppConversationMemory: async () => ({
        memory: {
          ...conversationMemory.EMPTY_WHATSAPP_CONVERSATION_MEMORY,
          summary: options.memorySummary ?? "",
        },
        messages: [],
      }),
      saveWhatsAppConversationMemory: async () => {},
    },
    "./supabase/admin.ts": { createAdminClient: () => client },
    "./whatsapp-provider.ts": {
      whatsappProvider: () => "test",
      sendWhatsAppTypingIndicator: async () => {},
      sendWhatsAppText: async (input: { body: string }) => { providerCalls++; sentBodies.push(input.body); return { provider: "test", providerMessageId: "fake", payload: {} }; },
    },
  };
  const source = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const testModule = { exports: {} as { respondToWhatsAppInbound: (input: { conversationId: string; inboundMessageId: string }) => Promise<{ status: string; closed?: boolean; appointmentAt?: string | null }> } };
  vm.runInNewContext(compiled.outputText, {
    module: testModule, exports: testModule.exports, console, Date, Intl, AbortSignal,
    process: { env: { INCEPTION_API_KEY: "local-test-only" } },
    require: (name: string) => name in dependencies ? dependencies[name] : nodeRequire(name),
    fetch: async (_url: string, init?: { body?: string }) => {
      generatedCalls++;
      if (init?.body) completionBodies.push(init.body);
      if (options.modelFailure) {
        return { ok: false, status: 503, json: async () => ({ error: { message: "unavailable" } }) };
      }
      const generatedHandoffKind = options.generatedHandoffKind ?? (options.handoff ? "human_requested" : "none");
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: "Ofrecemos atención comercial.", handoff: options.handoff ?? false, handoff_kind: generatedHandoffKind, handoff_reason: options.handoff ? "Solicita atención humana" : "", appointment_at: options.generatedAppointmentAt ?? null, scope: generatedHandoffKind === "unknown" ? "uncertain" : "in_scope", memory: conversationMemory.EMPTY_WHATSAPP_CONVERSATION_MEMORY }) } }] }) };
    },
  });
  const result = await testModule.exports.respondToWhatsAppInbound({ conversationId: "conversation", inboundMessageId: "inbound" });
  return { result, providerCalls, generatedCalls, configReads, updates, closeCalls, rpcCalls, sentBodies, completionBodies };
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
  const run = await runAutomation({ handoff: true, inboundText: "Quiero hablar con una persona" });
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  assert.ok(run.updates.filter((item) => item.table === "whatsapp_conversations").every((item) => !("ai_state" in item.value)));
});

test("ofrecer ayuda humana no deriva si el contacto no la pidió", async () => {
  const run = await runAutomation({
    handoff: true,
    generatedHandoffKind: "human_requested",
    inboundText: "Me interesa entender mejor el servicio",
  });
  assert.equal(run.result.status, "completed");
  assert.ok(!run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.equal(run.providerCalls, 1);
});

test("una consulta amplia recibe divulgación progresiva y no un folleto", async () => {
  const run = await runAutomation({
    inboundText: "Vi una publicación de una secretaria virtual y quiero información",
  });
  assert.equal(run.result.status, "completed");
  assert.equal(run.generatedCalls, 0);
  assert.equal(run.sentBodies.length, 1);
  assert.ok(run.sentBodies[0].length <= 420);
  assert.match(run.sentBodies[0], /ejecutiva real atiende tus llamadas o WhatsApp/i);
  assert.doesNotMatch(run.sentBodies[0], /1 UF|módulos|PyMEs|CRM/);
  assert.ok(!run.rpcCalls.includes("handoff_whatsapp_conversation"));
});

test("una respuesta determinista repetida pide precisión en vez de copiar el mismo texto", async () => {
  const repeated = "Claro. Una ejecutiva real atiende tus llamadas o WhatsApp cuando tú no puedes, registra el motivo y te avisa para que decidas cómo seguir. ¿Necesitas cubrir llamadas, WhatsApp o ambos?";
  const run = await runAutomation({
    inboundText: "Vi una publicación de una secretaria virtual y quiero información",
    previousOutboundText: repeated,
  });
  assert.equal(run.generatedCalls, 0);
  assert.equal(run.sentBodies.length, 1);
  assert.notEqual(run.sentBodies[0], repeated);
  assert.match(run.sentBodies[0], /sin repetirme/i);
});

test("un saludo nunca reactiva una coordinación histórica", async () => {
  const run = await runAutomation({ inboundText: "Hola" });
  assert.equal(run.result.status, "completed");
  assert.equal(run.generatedCalls, 0);
  assert.match(run.sentBodies[0], /¿En qué puedo ayudarte hoy\?/);
  assert.doesNotMatch(run.sentBodies[0], /agend|llamada|mañana|12:00/i);
});

test("una sesión retomada conserva contexto útil sin reenviar la coordinación antigua al modelo", async () => {
  const run = await runAutomation({
    inboundText: "¿Cómo funciona para una consulta dental?",
    oldAppointmentContext: true,
    memorySummary: "La persona administra una consulta dental.",
  });
  assert.equal(run.generatedCalls, 1);
  assert.match(run.completionBodies[0], /consulta dental/i);
  assert.doesNotMatch(run.completionBodies[0], /llamada antigua|mañana a las 12:00/i);
});

test("un handoff Mercury vencido sin respuesta humana vuelve a IA solo en ese hilo", async () => {
  const run = await runAutomation({
    initialState: "handoff",
    resumeExpiredHandoff: true,
    inboundText: "Hola",
  });
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  assert.ok(run.rpcCalls.includes("resume_expired_whatsapp_ai_handoff"));
  assert.match(run.sentBodies[0], /¿En qué puedo ayudarte hoy\?/);
});

test("la pregunta concreta sobre qué hace responde solo funciones", async () => {
  const run = await runAutomation({ inboundText: "Pero que hace la secretaria ?" });
  assert.equal(run.result.status, "completed");
  assert.equal(run.generatedCalls, 0);
  assert.match(run.sentBodies[0], /toma los datos y el motivo/i);
  assert.doesNotMatch(run.sentBodies[0], /1 UF|módulos|PyMEs|CRM/);
});

test("Mercury recibe la memoria acumulada para continuar sin volver a preguntar", async () => {
  const run = await runAutomation({
    inboundText: "¿Y WhatsApp?",
    memorySummary: "La persona administra una consulta dental y necesita cubrir 20 contactos diarios.",
  });
  assert.equal(run.result.status, "completed");
  assert.equal(run.generatedCalls, 1);
  assert.match(run.completionBodies[0], /consulta dental/);
  assert.match(run.completionBodies[0], /20 contactos diarios/);
});

test("un fallo del modelo deriva con una confirmación y no deja al contacto en silencio", async () => {
  const run = await runAutomation({ modelFailure: true });
  assert.equal(run.result.status, "completed");
  assert.equal(run.providerCalls, 1);
  assert.ok(run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.match(run.sentBodies[0], /no pude procesarlo correctamente/i);
});

test("Secretaría Virtual deriva una solicitud de agendamiento sin confirmarla automáticamente", async () => {
  const run = await runAutomation({
    inboundText: "Quiero agendar una llamada mañana a las 15:00",
    automaticAppointmentBooking: false,
    handoff: true,
    generatedHandoffKind: "appointment",
    generatedAppointmentAt: "2026-09-03T15:00:00-04:00",
  });
  assert.equal(run.result.status, "completed");
  assert.equal(run.result.appointmentAt, null);
  assert.ok(run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.ok(!run.rpcCalls.includes("schedule_whatsapp_callback"));
});

test("una solicitud natural de llamada también deriva sin prometer que quedó agendada", async () => {
  const run = await runAutomation({
    inboundText: "¿Me pueden llamar mañana?",
    automaticAppointmentBooking: false,
  });
  assert.equal(run.result.status, "completed");
  assert.ok(run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.ok(!run.rpcCalls.includes("schedule_whatsapp_callback"));
  assert.doesNotMatch(run.sentBodies[0], /qued[oó]\s+agend|confirmad[ao]|disponibilidad\s+confirmada/i);
});

test("un dato de fecha u hora continúa una coordinación y deriva en vez de confirmarla", async () => {
  const run = await runAutomation({
    inboundText: "la próxima semana el lunes",
    previousOutboundText: "¿A qué hora quieres que programemos la llamada?",
    automaticAppointmentBooking: false,
  });
  assert.ok(run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.match(run.sentBodies[0], /persona de nuestro equipo.*confirme/i);
});

test("preguntar por la capacidad de coordinar agendas no agenda al propio contacto", async () => {
  const run = await runAutomation({
    inboundText: "¿La secretaria puede coordinar reuniones de mi empresa?",
    automaticAppointmentBooking: false,
  });
  assert.equal(run.generatedCalls, 1);
  assert.ok(!run.rpcCalls.includes("handoff_whatsapp_conversation"));
});

test("una pregunta de cultura general se limita al dominio y no deriva", async () => {
  const run = await runAutomation({
    inboundText: "¿Me puedes resumir en 10 líneas la historia de Chile?",
  });
  assert.equal(run.generatedCalls, 0);
  assert.ok(!run.rpcCalls.includes("handoff_whatsapp_conversation"));
  assert.match(run.sentBodies[0], /Solo puedo ayudarte con los servicios/i);
  assert.doesNotMatch(run.sentBodies[0], /1541|independencia|Valdivia/i);
});

test("nada todo ok se interpreta como cierre y no como una nueva oportunidad de venta", async () => {
  const run = await runAutomation({ inboundText: "nada todo ok" });
  assert.equal(run.generatedCalls, 0);
  assert.equal(run.closeCalls, 1);
  assert.equal(run.sentBodies.length, 1);
  assert.match(run.sentBodies[0], /gracias por contactarnos/i);
});

test("gracias con coma cierra si la respuesta anterior ya presentó el cierre", async () => {
  const run = await runAutomation({
    inboundText: "gracias,",
    previousOutboundText: "Listo, te contactaremos el lunes. Si surge alguna duda antes, avísanos.",
  });
  assert.equal(run.closeCalls, 1);
  assert.match(run.sentBodies[0], /excelente día/i);
});

test("un acuse posterior a la despedida vuelve a cerrar sin repetir otro mensaje", async () => {
  const run = await runAutomation({
    inboundText: "bueno",
    previousOutboundText: "Perfecto, gracias por contactarnos. Que tengas un excelente día.",
  });
  assert.equal(run.closeCalls, 1);
  assert.equal(run.providerCalls, 0);
  assert.equal(run.result.closed, true);
});

test("gracias pero una pregunta nueva no se interpreta como despedida", async () => {
  const run = await runAutomation({
    inboundText: "gracias, pero quiero saber el precio",
    previousOutboundText: "¿Tienes alguna otra duda o consulta?",
  });
  assert.equal(run.generatedCalls, 1);
  assert.equal(run.closeCalls, 0);
});

test("una cotización formal se deriva aunque el proveedor no active el handoff", async () => {
  const run = await runAutomation({ inboundText: "Quiero una cotización formal para contratar" });
  assert.equal(run.result.status, "completed");
  assert.ok(run.rpcCalls.includes("handoff_whatsapp_conversation"));
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
