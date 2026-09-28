import assert from "node:assert/strict";
import test from "node:test";
import { BUSY_HOLD_REASON, desiredPauseState } from "./pauseDecision";

const libre = { inWrapUp: false, pauseReasonLabel: "Disponible", isPauseReason: false, busy: false };

test("un ejecutivo libre queda en la cola con su estado", () => {
  assert.deepEqual(desiredPauseState(libre), { paused: false, reasonLabel: "Disponible", busyHold: false });
});

test("ocupado con otra gestión sale de la cola aunque su sesión diga disponible", () => {
  assert.deepEqual(desiredPauseState({ ...libre, busy: true }), {
    paused: true,
    reasonLabel: BUSY_HOLD_REASON,
    busyHold: true,
  });
});

test("el cierre y el AUX mandan sobre la ocupación: son estados que el CRM muestra", () => {
  assert.deepEqual(desiredPauseState({ ...libre, busy: true, inWrapUp: true }), {
    paused: true,
    reasonLabel: "Cierre y tipificación",
    busyHold: false,
  });
  assert.deepEqual(desiredPauseState({ ...libre, busy: true, isPauseReason: true, pauseReasonLabel: "Baño" }), {
    paused: true,
    reasonLabel: "Baño",
    busyHold: false,
  });
});
