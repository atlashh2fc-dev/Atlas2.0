import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826211500_whatsapp_ai_and_closure.sql", import.meta.url),
  "utf8",
);
const composer = readFileSync(
  new URL("../src/components/whatsapp-composer.tsx", import.meta.url),
  "utf8",
);
const completionMigration = readFileSync(
  new URL("../supabase/migrations/20260826234500_whatsapp_callback_and_customer_goodbye.sql", import.meta.url),
  "utf8",
);
const mercury = readFileSync(new URL("../src/lib/mercury-whatsapp.ts", import.meta.url), "utf8");
const provider = readFileSync(new URL("../src/lib/whatsapp-provider.ts", import.meta.url), "utf8");
const campaignLoop = readFileSync(new URL("../dialer-engine/src/dialer/campaignLoop.ts", import.meta.url), "utf8");

test("Enter envía y Shift+Enter conserva el salto de línea", () => {
  assert.match(composer, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(composer, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
});

test("cada cierre requiere tipificación válida de la campaña", () => {
  assert.match(migration, /status <> 'closed' or \(close_reason_id is not null and closed_at is not null\)/);
  assert.match(migration, /and campaign_id = v_conversation\.campaign_id/);
  assert.match(migration, /whatsapp_closure_note_required/);
});

test("el timeout ocurre solo después de una respuesta saliente sin nueva respuesta del contacto", () => {
  assert.match(migration, /conversation\.last_outbound_at is not null/);
  assert.match(migration, /conversation\.last_outbound_at >= coalesce\(conversation\.last_inbound_at/);
  assert.match(migration, /conversation\.last_outbound_at <= now\(\) - make_interval/);
});

test("un mensaje inbound solo puede originar una ejecución de IA", () => {
  assert.match(migration, /inbound_message_id uuid not null unique/);
  assert.match(migration, /status in \('processing', 'completed', 'skipped', 'failed'\)/);
});

test("WhatsApp muestra el indicador nativo de escritura antes de responder", () => {
  assert.match(provider, /inboundMessages\/\$\{encodeURIComponent\(input\.providerMessageId\)\}\/typingIndicator/);
  assert.match(provider, /typing_indicator: \{ type: "text" \}/);
  assert.ok(mercury.indexOf("sendWhatsAppTypingIndicator") < mercury.indexOf("askMercury({"));
});

test("un agendamiento crea un callback personal real con trazabilidad", () => {
  assert.match(completionMigration, /create or replace function public\.schedule_whatsapp_callback/);
  assert.match(completionMigration, /next_action_at = p_scheduled_at/);
  assert.match(completionMigration, /callback_mode = 'personal'/);
  assert.match(completionMigration, /workflow_status = 'callback'/);
  assert.match(completionMigration, /'lead\.callback_scheduled'/);
  assert.match(mercury, /admin\.rpc\(rpcName, rpcArgs\)/);
});

test("la campaña inbound procesa callbacks pero nunca entra al pool masivo", () => {
  const callbackPosition = campaignLoop.indexOf("claimDuePersonalCallbacks");
  const inboundGuardPosition = campaignLoop.indexOf('cfg.campaign_type === "inbound"');
  const poolPosition = campaignLoop.indexOf("claimNextDialTargets(cfg.campaign_id");
  assert.ok(callbackPosition >= 0 && inboundGuardPosition > callbackPosition && poolPosition > inboundGuardPosition);
  assert.match(completionMigration, /campaign\.id, 'inbound', 'progressive'/);
});

test("agradecimiento, despedida y cierre automático tienen reglas explícitas", () => {
  assert.match(mercury, /De nada\. ¿Tienes alguna otra duda o consulta en que pueda ayudarte\?/);
  assert.match(mercury, /customerFinishedConversation/);
  assert.match(mercury, /code", "customer_finished"/);
  assert.match(completionMigration, /'customer_finished'/);
  assert.match(completionMigration, /'Conversación finalizada por el contacto'/);
});
