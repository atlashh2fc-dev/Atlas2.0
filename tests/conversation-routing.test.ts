import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { attentionChannelHref } from "../src/lib/campaign-channels.ts";

const whatsappInbox = readFileSync(
  new URL("../src/app/dashboard/conversaciones/whatsapp/page.tsx", import.meta.url),
  "utf8",
);

test("cada deep link conserva el canal y el estado de la conversación", () => {
  assert.equal(attentionChannelHref("phone"), "/dashboard/conversaciones/voz");
  assert.equal(
    attentionChannelHref("whatsapp", {
      status: "open",
      campaign: "campaign-id",
      queue: "queue-id",
      conversation: "conversation-id",
    }),
    "/dashboard/conversaciones/whatsapp?status=open&campaign=campaign-id&queue=queue-id&conversation=conversation-id",
  );
  assert.equal(
    attentionChannelHref("mail", { status: "all", campaign: null }),
    "/dashboard/conversaciones/correo?status=all",
  );
});

test("la bandeja WhatsApp nunca envía tarjetas ni filtros al índice genérico", () => {
  assert.doesNotMatch(
    whatsappInbox,
    /return `\/dashboard\/conversaciones\?|action="\/dashboard\/conversaciones"/,
  );
  assert.match(
    whatsappInbox,
    /return attentionChannelHref\("whatsapp", \{[\s\S]*?conversation,[\s\S]*?\}\);/,
  );
  assert.match(
    whatsappInbox,
    /action=\{attentionChannelHref\("whatsapp"\)\}/,
  );
});
