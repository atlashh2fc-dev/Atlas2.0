import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyElevenLabsOutboundFailure,
  elevenLabsConversationFailureReason,
  mapElevenLabsStatus,
} from "../elevenlabs/status";
import { buildElevenLabsOutboundCallPayload } from "../elevenlabs/client";

test("mapElevenLabsStatus conserva el ciclo de vida de una conversación", () => {
  assert.equal(mapElevenLabsStatus("initiated"), "originating");
  assert.equal(mapElevenLabsStatus("in-progress"), "answered");
  assert.equal(mapElevenLabsStatus("processing"), "answered");
  assert.equal(mapElevenLabsStatus("done"), "completed");
  assert.equal(mapElevenLabsStatus("failed"), "failed");
});

test("clasifica SIP 486 como ocupado y conserva fallas reales del proveedor", () => {
  assert.equal(
    classifyElevenLabsOutboundFailure(new Error("INVITE failed: sip status: 486: Busy Here (SIP 486)")),
    "busy"
  );
  assert.equal(
    classifyElevenLabsOutboundFailure(new Error("Agent exceeded its daily call limit")),
    "failed"
  );
});

test("usa el error de inicialización cuando termination_reason viene vacío", () => {
  assert.equal(
    elevenLabsConversationFailureReason({
      conversation_id: "conv_test",
      status: "failed",
      metadata: {
        termination_reason: "",
        error: {
          code: 4300,
          reason: "Agent has exceeded its daily call limit of 5.",
          error_type: "call_initialization_error",
        },
      },
    }),
    "Agent has exceeded its daily call limit of 5."
  );
});

test("la llamada manual envia su correlacion sin inventar un lead", () => {
  const payload = buildElevenLabsOutboundCallPayload({
    apiKey: "test",
    agentId: "agent_test",
    phoneNumberId: "phnum_test",
    toNumber: "+56 9 2843 3242",
    campaignId: "campaign-test",
    testCallId: "test-call-id",
    contactName: "Matías",
  });

  assert.equal(payload.to_number, "+56928433242");
  assert.deepEqual(payload.conversation_initiation_client_data.dynamic_variables, {
    atlas_campaign_id: "campaign-test",
    contact_name: "Matías",
    atlas_test_call_id: "test-call-id",
  });
});
