import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseWhatsAppWebhook,
  parseYCloudWebhook,
  verifyMetaWebhookSignature,
  verifyYCloudWebhookSignature,
} from "../src/lib/whatsapp.ts";

test("firma webhook de Meta usa HMAC SHA-256 y comparación exacta", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = "app-secret-test";
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyMetaWebhookSignature(secret, body, `sha256=${signature}`), true);
  assert.equal(verifyMetaWebhookSignature(secret, body, `sha256=${"0".repeat(64)}`), false);
  assert.equal(verifyMetaWebhookSignature(secret, body, null), false);
});

test("firma webhook de YCloud protege timestamp y cuerpo crudo", () => {
  const body = Buffer.from('{"id":"evt-1","type":"whatsapp.inbound_message.received"}');
  const secret = "ycloud-signing-secret";
  const timestamp = "1787752800";
  const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");

  assert.equal(verifyYCloudWebhookSignature(secret, body, `t=${timestamp},s=${signature}`), true);
  assert.equal(verifyYCloudWebhookSignature(secret, body, `s=${signature},t=${timestamp}`), true);
  assert.equal(verifyYCloudWebhookSignature(secret, Buffer.from("{}"), `t=${timestamp},s=${signature}`), false);
  assert.equal(verifyYCloudWebhookSignature(secret, body, null), false);
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

test("YCloud conserva el lead de Meta Ads y normaliza el mensaje entrante", () => {
  const [event] = parseYCloudWebhook({
    id: "evt-inbound-1",
    type: "whatsapp.inbound_message.received",
    apiVersion: "v2",
    createTime: "2026-08-26T12:00:00.000Z",
    whatsappInboundMessage: {
      id: "ycloud-message-1",
      wamid: "wamid.ycloud-inbound-1",
      wabaId: "1069013248503244",
      from: "+56911112222",
      fromUserId: "CL.1234",
      customerProfile: { name: "Cliente YCloud" },
      to: "+56974159166",
      sendTime: "2026-08-26T12:00:00.000Z",
      type: "text",
      text: { body: "Vengo del anuncio" },
      referral: {
        source_type: "ad",
        source_id: "meta-ad-yc-1",
        headline: "Campaña Geimser",
      },
    },
  });

  assert.equal(event.kind, "message");
  if (event.kind !== "message") return;
  assert.equal(event.direction, "inbound");
  assert.equal(event.phoneNumberId, "1069013248503244");
  assert.equal(event.businessPhone, "+56974159166");
  assert.equal(event.contactWaId, "56911112222");
  assert.equal(event.contactPhone, "+56911112222");
  assert.equal(event.textBody, "Vengo del anuncio");
  assert.equal(event.referral.source_id, "meta-ad-yc-1");
  assert.equal(event.eventKey, "message:wamid.ycloud-inbound-1");
});

test("YCloud refleja como salida lo enviado desde la app móvil", () => {
  const [event] = parseYCloudWebhook({
    id: "evt-echo-1",
    type: "whatsapp.smb.message.echoes",
    createTime: "2026-08-26T12:01:00.000Z",
    whatsappMessage: {
      id: "ycloud-echo-1",
      wamid: "wamid.ycloud-echo-1",
      wabaId: "1069013248503244",
      from: "+56974159166",
      to: "+56933334444",
      toParentUserId: "CL.5678",
      sendTime: "2026-08-26T12:01:00.000Z",
      type: "text",
      text: { body: "Respuesta desde el celular" },
    },
  });

  assert.equal(event.kind, "message");
  if (event.kind !== "message") return;
  assert.equal(event.direction, "outbound");
  assert.equal(event.contactWaId, "56933334444");
  assert.equal(event.contactPhone, "+56933334444");
  assert.equal(event.textBody, "Respuesta desde el celular");
});

test("YCloud actualiza estados usando el wamid de WhatsApp", () => {
  const [event] = parseYCloudWebhook({
    id: "evt-status-1",
    type: "whatsapp.message.updated",
    createTime: "2026-08-26T12:02:00.000Z",
    whatsappMessage: {
      id: "ycloud-outbound-1",
      wamid: "wamid.ycloud-outbound-1",
      wabaId: "1069013248503244",
      from: "+56974159166",
      status: "delivered",
      deliverTime: "2026-08-26T12:02:00.000Z",
    },
  });

  assert.equal(event.kind, "status");
  if (event.kind !== "status") return;
  assert.equal(event.providerMessageId, "wamid.ycloud-outbound-1");
  assert.equal(event.status, "delivered");
});

test("YCloud no importa historial antiguo ni grupos", () => {
  assert.deepEqual(parseYCloudWebhook({ type: "whatsapp.smb.history" }), []);
  assert.deepEqual(parseYCloudWebhook({
    type: "whatsapp.inbound_message.received",
    whatsappInboundMessage: { groupId: "group@g.us" },
  }), []);
});
