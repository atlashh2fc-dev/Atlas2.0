import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_WHATSAPP_CONVERSATION_MEMORY,
  whatsappConversationMemorySchema,
} from "../src/lib/whatsapp-conversation-memory.ts";
import { MAX_MERCURY_WHATSAPP_REPLY_LENGTH } from "../src/lib/mercury-whatsapp-schema.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260901221500_whatsapp_durable_memory_and_retry.sql", import.meta.url),
  "utf8",
);
const mercury = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
const worker = readFileSync(
  new URL("../src/app/api/integrations/meta/whatsapp/ai-worker/route.ts", import.meta.url),
  "utf8",
);

test("la memoria estructurada es acotada y no acepta contenido ilimitado", () => {
  assert.deepEqual(whatsappConversationMemorySchema.parse(EMPTY_WHATSAPP_CONVERSATION_MEMORY), EMPTY_WHATSAPP_CONVERSATION_MEMORY);
  assert.throws(() => whatsappConversationMemorySchema.parse({
    ...EMPTY_WHATSAPP_CONVERSATION_MEMORY,
    summary: "x".repeat(1201),
  }));
});

test("la memoria persiste de forma atómica y solo queda disponible al servicio", () => {
  assert.match(migration, /create table public\.whatsapp_conversation_memories/);
  assert.match(migration, /primary key \(conversation_id, message_id\)/);
  assert.match(migration, /save_whatsapp_conversation_memory/);
  assert.match(migration, /on conflict \(conversation_id\) do update/);
  assert.match(migration, /revoke all on table public\.whatsapp_conversation_memories from anon, authenticated/);
  assert.match(migration, /grant all on table public\.whatsapp_conversation_memories to service_role/);
});

test("Mercury combina memoria acumulada, historial pendiente y mensajes recientes", () => {
  assert.match(mercury, /Memoria acumulada de esta conversación/);
  assert.match(mercury, /Mensajes históricos aún no consolidados/);
  assert.match(mercury, /saveWhatsAppConversationMemory/);
  assert.match(mercury, /Respuesta previa del equipo humano/);
});

test("la respuesta tiene un límite conversacional real", () => {
  assert.equal(MAX_MERCURY_WHATSAPP_REPLY_LENGTH, 420);
  assert.match(mercury, /máximo tres frases, dos párrafos y una sola pregunta/i);
  assert.match(mercury, /DIVULGACIÓN PROGRESIVA/);
});

test("un trabajo durable recupera mensajes sin ejecución y fallos reintentables", () => {
  assert.match(migration, /get_whatsapp_ai_work/);
  assert.match(migration, /run\.id is null/);
  assert.match(migration, /run\.status = 'failed'/);
  assert.match(worker, /respondToWhatsAppInbound/);
  assert.match(worker, /CRON_SECRET/);
});
