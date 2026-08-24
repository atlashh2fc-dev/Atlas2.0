import assert from "node:assert/strict";
import test from "node:test";
import { mapElevenLabsStatus } from "../elevenlabs/status";

test("mapElevenLabsStatus conserva el ciclo de vida de una conversación", () => {
  assert.equal(mapElevenLabsStatus("initiated"), "originating");
  assert.equal(mapElevenLabsStatus("in-progress"), "answered");
  assert.equal(mapElevenLabsStatus("processing"), "answered");
  assert.equal(mapElevenLabsStatus("done"), "completed");
  assert.equal(mapElevenLabsStatus("failed"), "failed");
});
