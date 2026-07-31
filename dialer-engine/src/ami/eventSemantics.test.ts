import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAmiUniqueId, queueMemberDialerStatus } from "./eventSemantics";

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
