import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAmiUniqueId,
  normalizeCallDisconnectParty,
  normalizeQueueTalkSeconds,
  queueMemberDialerStatus,
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
