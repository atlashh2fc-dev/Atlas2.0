import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826175504_scope_whatsapp_conversations_by_campaign.sql", import.meta.url),
  "utf8",
);
const webhookProcessor = readFileSync(
  new URL("../src/lib/whatsapp-webhook-processing.ts", import.meta.url),
  "utf8",
);

test("cada conversación de WhatsApp queda aislada por campaña", () => {
  assert.match(
    migration,
    /unique\s*\(channel_id,\s*campaign_id,\s*contact_wa_id\)/i,
  );
  assert.match(
    migration,
    /where channel_id = p_channel_id\s+and campaign_id = p_campaign_id\s+and contact_wa_id = p_contact_wa_id/i,
  );
});

test("los seguimientos sin referral conservan el hilo comercial activo", () => {
  const activeConversationLookup = webhookProcessor.indexOf('.from("whatsapp_conversations")');
  const defaultRouteLookup = webhookProcessor.indexOf('.eq("is_default", true)');

  assert.ok(activeConversationLookup >= 0);
  assert.ok(defaultRouteLookup > activeConversationLookup);
  assert.match(webhookProcessor, /\.in\("status", \["open", "pending"\]\)/);
  assert.match(webhookProcessor, /\.order\("last_message_at", \{ ascending: false \}\)/);
});
