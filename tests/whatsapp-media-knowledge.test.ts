import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeWhatsAppMediaMimeType,
  validateWhatsAppMedia,
} from "../src/lib/whatsapp-media-format.ts";

const mediaMigration = readFileSync(
  new URL("../supabase/migrations/20260826224500_whatsapp_message_media.sql", import.meta.url),
  "utf8",
);
const knowledgeMigration = readFileSync(
  new URL("../supabase/migrations/20260826225000_whatsapp_ai_product_knowledge.sql", import.meta.url),
  "utf8",
);
const mercury = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
const conversations = readFileSync(new URL("../src/app/dashboard/conversaciones/page.tsx", import.meta.url), "utf8");
const handoffMigration = readFileSync(
  new URL("../supabase/migrations/20260826231000_route_whatsapp_handoffs_to_laura.sql", import.meta.url),
  "utf8",
);
const mediaCapture = readFileSync(new URL("../src/lib/whatsapp-media.ts", import.meta.url), "utf8");

test("multimedia de WhatsApp usa bucket privado y no concede acceso directo al navegador", () => {
  assert.match(mediaMigration, /'whatsapp-media',[\s\S]*?false,[\s\S]*?16777216/);
  assert.match(mediaMigration, /revoke all on table public\.whatsapp_media_uploads from anon, authenticated/);
  assert.doesNotMatch(mediaMigration, /create policy[\s\S]*?whatsapp-media/);
});

test("la captura histórica resuelve el proveedor desde el evento original", () => {
  assert.match(mediaCapture, /provider_message_id/);
  assert.match(mediaCapture, /whatsapp_webhook_events/);
  assert.match(mediaCapture, /\.eq\("provider_event_key", `message:\$\{message\.provider_message_id\}`\)/);
  assert.match(mediaCapture, /sourceProvider \?\? whatsappProvider\(\)/);
  assert.match(mediaCapture, /if \(input\.mediaId\)[\s\S]*?metaMediaUrl\(input\.mediaId\)/);
});

test("acepta notas de voz de WhatsApp y audios M4A del iPhone", () => {
  assert.equal(normalizeWhatsAppMediaMimeType("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(normalizeWhatsAppMediaMimeType("audio/x-m4a"), "audio/mp4");
  assert.equal(validateWhatsAppMedia({ mimeType: "audio/mp3", sizeBytes: 10_075 }).messageType, "audio");
  assert.throws(
    () => validateWhatsAppMedia({ mimeType: "audio/wav", sizeBytes: 10_075 }),
    /Formato no compatible/,
  );
});

test("la ficha del producto es explícita y deriva lo que no está confirmado", () => {
  assert.match(knowledgeMigration, /plan de entrada de 1 UF/);
  assert.match(knowledgeMigration, /No están confirmados en esta ficha/);
  assert.match(knowledgeMigration, /devuelve handoff=true/);
  assert.match(mercury, /Información aprobada del producto/);
  assert.match(mercury, /no la infieras:[\s\S]*?handoff=true/);
});

test("la derivación Mercury asigna conversación y lead a la cola con contexto", () => {
  assert.match(handoffMigration, /create or replace function public\.handoff_whatsapp_conversation/);
  assert.match(handoffMigration, /update public\.lead_assignments[\s\S]*?insert into public\.lead_assignments/);
  assert.match(handoffMigration, /update public\.leads[\s\S]*?assigned_to = v_agent_id/);
  assert.match(handoffMigration, /update public\.whatsapp_conversations[\s\S]*?ai_state = 'handoff'/);
  assert.match(handoffMigration, /'lpincheirah\.geimser@gmail\.com'/);
  assert.match(mercury, /p_kind: handoffKind/);
  assert.match(conversations, /handoffKindLabel/);
  assert.match(conversations, /Asignada a \{assigned\?\.full_name/);
});

test("humano y agendamiento son gatillos explícitos de derivación", () => {
  assert.match(mercury, /human_requested/);
  assert.match(mercury, /appointmentRequest/);
  assert.match(mercury, /pide agendar, coordinar una reunión, llamada o cita/);
});
