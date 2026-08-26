import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mediaMigration = readFileSync(
  new URL("../supabase/migrations/20260826224500_whatsapp_message_media.sql", import.meta.url),
  "utf8",
);
const knowledgeMigration = readFileSync(
  new URL("../supabase/migrations/20260826225000_whatsapp_ai_product_knowledge.sql", import.meta.url),
  "utf8",
);
const mercury = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
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
});

test("la ficha del producto es explícita y deriva lo que no está confirmado", () => {
  assert.match(knowledgeMigration, /plan de entrada de 1 UF/);
  assert.match(knowledgeMigration, /No están confirmados en esta ficha/);
  assert.match(knowledgeMigration, /devuelve handoff=true/);
  assert.match(mercury, /Información aprobada del producto/);
  assert.match(mercury, /no la infieras:[\s\S]*?handoff=true/);
});
