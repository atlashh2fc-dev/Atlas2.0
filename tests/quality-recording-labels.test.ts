import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRecordingIntegrity,
  qualityTypificationLabel,
} from "../src/lib/quality-recording-labels.ts";

test("distingue tipificación, pendiente, descarte técnico y cierre sin tipificación", () => {
  assert.equal(
    qualityTypificationLabel({ typification: "NO CONTESTA", callEndedAt: null, callDiscardedReason: null }),
    "NO CONTESTA"
  );
  assert.equal(
    qualityTypificationLabel({ typification: null, callEndedAt: null, callDiscardedReason: null }),
    "Pendiente de tipificar"
  );
  assert.equal(
    qualityTypificationLabel({ typification: null, callEndedAt: "2026-08-14T20:00:00Z", callDiscardedReason: "audio" }),
    "Descartada por error técnico"
  );
  assert.equal(
    qualityTypificationLabel({ typification: null, callEndedAt: "2026-08-14T20:00:00Z", callDiscardedReason: null }),
    "Sin tipificación registrada"
  );
});

test("detecta audio incompleto con tolerancia de dos segundos", () => {
  assert.equal(
    classifyRecordingIntegrity({ endedAt: null, durationSeconds: 10, queueTalkSeconds: 10 }),
    "recording"
  );
  assert.equal(
    classifyRecordingIntegrity({ endedAt: "2026-08-14T20:00:00Z", durationSeconds: null, queueTalkSeconds: 10 }),
    "unknown"
  );
  assert.equal(
    classifyRecordingIntegrity({ endedAt: "2026-08-14T20:00:00Z", durationSeconds: 8, queueTalkSeconds: 10 }),
    "complete"
  );
  assert.equal(
    classifyRecordingIntegrity({ endedAt: "2026-08-14T20:00:00Z", durationSeconds: 7.9, queueTalkSeconds: 10 }),
    "incomplete"
  );
});
