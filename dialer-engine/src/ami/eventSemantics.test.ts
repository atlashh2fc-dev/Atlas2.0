import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAmiUniqueId,
  normalizeCallDisconnectParty,
  normalizeQueueTalkSeconds,
  personalCallbackHangupEvent,
  queueMemberDialerStatus,
  secondsSince,
} from "./eventSemantics";

test("normaliza sentinelas AMI como ausencia de unique id", () => {
  for (const value of [undefined, null, "", " ", "unknown", "<unknown>", "NULL", "none"]) {
    assert.equal(normalizeAmiUniqueId(value), null);
  }
  assert.equal(normalizeAmiUniqueId("1785514115.53"), "1785514115.53");
});

test("solo considera disponible a un miembro realmente libre", () => {
  assert.equal(queueMemberDialerStatus("0", "1"), "available");
  assert.equal(queueMemberDialerStatus("0", "5"), "offline");
  assert.equal(queueMemberDialerStatus("0", "6"), "ringing");
  assert.equal(queueMemberDialerStatus("0", "2"), "on_call");
  assert.equal(queueMemberDialerStatus("1", "1"), "paused");
  assert.equal(queueMemberDialerStatus("0", undefined), null);
});

test("normaliza quién terminó una llamada usando AgentComplete.Reason", () => {
  assert.equal(normalizeCallDisconnectParty("caller"), "caller");
  assert.equal(normalizeCallDisconnectParty("AGENT"), "agent");
  assert.equal(normalizeCallDisconnectParty(" transfer "), "transfer");
  assert.equal(normalizeCallDisconnectParty("unknown"), null);
  assert.equal(normalizeCallDisconnectParty(undefined), null);
});

test("acepta solo TalkTime entero y no negativo", () => {
  assert.equal(normalizeQueueTalkSeconds("37"), 37);
  assert.equal(normalizeQueueTalkSeconds(0), 0);
  assert.equal(normalizeQueueTalkSeconds("3.5"), null);
  assert.equal(normalizeQueueTalkSeconds(-1), null);
  assert.equal(normalizeQueueTalkSeconds(undefined), null);
});

test("una agenda personal con conversación termina completed aunque la causa SIP diga otra cosa", () => {
  assert.equal(personalCallbackHangupEvent({ bridged: true, customerDialStatus: "ANSWER" }), "completed");
  assert.equal(personalCallbackHangupEvent({ bridged: true, customerDialStatus: undefined }), "completed");
});

test("una agenda personal sin conversación usa el DialStatus del cliente, no la causa 16 del ejecutivo", () => {
  assert.equal(personalCallbackHangupEvent({ bridged: false, customerDialStatus: "NOANSWER" }), "no_answer");
  assert.equal(personalCallbackHangupEvent({ bridged: false, customerDialStatus: "cancel" }), "no_answer");
  assert.equal(personalCallbackHangupEvent({ bridged: false, customerDialStatus: "BUSY" }), "busy");
  assert.equal(personalCallbackHangupEvent({ bridged: false, customerDialStatus: "CHANUNAVAIL" }), "failed");
  assert.equal(personalCallbackHangupEvent({ bridged: false, customerDialStatus: null }), "failed");
});

test("mide la conversación desde que el cliente contestó", () => {
  assert.equal(secondsSince(1_000, 35_400), 34);
  assert.equal(secondsSince(undefined, 35_400), null);
  assert.equal(secondsSince(40_000, 35_400), null);
});
