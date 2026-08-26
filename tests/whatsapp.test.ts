import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { parseWhatsAppWebhook, verifyMetaWebhookSignature } from "../src/lib/whatsapp.ts";

test("firma webhook de Meta usa HMAC SHA-256 y comparación exacta", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = "app-secret-test";
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyMetaWebhookSignature(secret, body, `sha256=${signature}`), true);
  assert.equal(verifyMetaWebhookSignature(secret, body, `sha256=${"0".repeat(64)}`), false);
  assert.equal(verifyMetaWebhookSignature(secret, body, null), false);
});

test("mensaje click-to-WhatsApp conserva identidad y referencia del anuncio", () => {
  const events = parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-1",
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "877022598829325" },
          contacts: [{ wa_id: "56911112222", profile: { name: "Cliente Meta" } }],
          messages: [{
            id: "wamid.inbound-1",
            from: "56911112222",
            timestamp: "1787752800",
            type: "text",
            text: { body: "Hola, quiero información" },
            referral: {
              source_type: "ad",
              source_id: "meta-ad-123",
              headline: "Capital Semilla",
              body: "Postula con apoyo",
            },
          }],
        },
      }],
    }],
  });

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.kind, "message");
  if (event.kind !== "message") return;
  assert.equal(event.direction, "inbound");
  assert.equal(event.contactPhone, "+56911112222");
  assert.equal(event.contactName, "Cliente Meta");
  assert.equal(event.textBody, "Hola, quiero información");
  assert.equal(event.referral.source_id, "meta-ad-123");
  assert.equal(event.eventKey, "message:wamid.inbound-1");
});

test("coexistencia refleja como salida los mensajes enviados desde el celular", () => {
  const [event] = parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "smb_message_echoes",
        value: {
          metadata: { phone_number_id: "877022598829325" },
          messages: [{
            id: "wamid.echo-1",
            from: "56974159166",
            to: "56933334444",
            timestamp: "1787752801",
            type: "text",
            text: { body: "Te envío la información" },
          }],
        },
      }],
    }],
  });

  assert.equal(event.kind, "message");
  if (event.kind !== "message") return;
  assert.equal(event.direction, "outbound");
  assert.equal(event.contactWaId, "56933334444");
  assert.equal(event.textBody, "Te envío la información");
});

test("estados se vuelven eventos idempotentes separados", () => {
  const [event] = parseWhatsAppWebhook({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "877022598829325" },
          statuses: [{
            id: "wamid.out-1",
            status: "delivered",
            timestamp: "1787752802",
          }],
        },
      }],
    }],
  });

  assert.equal(event.kind, "status");
  if (event.kind !== "status") return;
  assert.equal(event.status, "delivered");
  assert.match(event.eventKey, /^status:wamid\.out-1:delivered:/);
});
