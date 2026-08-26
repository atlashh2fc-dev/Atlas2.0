import assert from "node:assert/strict";
import test from "node:test";

import { mercuryWhatsAppReplySchema } from "../src/lib/mercury-whatsapp-schema.ts";

test("Mercury WhatsApp accepts a bounded customer reply", () => {
  const parsed = mercuryWhatsAppReplySchema.parse({
    reply: "Hola, soy la asistente virtual de Geimser. ¿En qué podemos ayudarte?",
    handoff: false,
    handoff_kind: "none",
    handoff_reason: "",
  });
  assert.equal(parsed.handoff, false);
});

test("Mercury WhatsApp rejects an empty reply", () => {
  assert.throws(() => mercuryWhatsAppReplySchema.parse({
    reply: " ",
    handoff: false,
    handoff_kind: "none",
    handoff_reason: "",
  }));
});

test("Mercury WhatsApp exige tipo y motivo cuando deriva", () => {
  const parsed = mercuryWhatsAppReplySchema.parse({
    reply: "Te derivaré con nuestra especialista para coordinarlo.",
    handoff: true,
    handoff_kind: "appointment",
    handoff_reason: "Solicita agendar una reunión.",
  });
  assert.equal(parsed.handoff_kind, "appointment");

  assert.throws(() => mercuryWhatsAppReplySchema.parse({
    reply: "Te derivaré.",
    handoff: true,
    handoff_kind: "none",
    handoff_reason: "",
  }));
});
