import assert from "node:assert/strict";
import test from "node:test";

import { mercuryWhatsAppReplySchema } from "../src/lib/mercury-whatsapp-schema.ts";

test("Mercury WhatsApp accepts a bounded customer reply", () => {
  const parsed = mercuryWhatsAppReplySchema.parse({
    reply: "Hola, soy la asistente virtual de Geimser. ¿En qué podemos ayudarte?",
    handoff: false,
    handoff_reason: "",
  });
  assert.equal(parsed.handoff, false);
});

test("Mercury WhatsApp rejects an empty reply", () => {
  assert.throws(() => mercuryWhatsAppReplySchema.parse({
    reply: " ",
    handoff: false,
    handoff_reason: "",
  }));
});
