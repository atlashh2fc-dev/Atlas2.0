import assert from "node:assert/strict";
import test from "node:test";
import { AttemptEventLifecycle } from "./eventLifecycle";

test("retiene la correlación cuando Hangup llega antes que AgentComplete", () => {
  const lifecycle = new AttemptEventLifecycle();
  assert.deepEqual(lifecycle.registerHangup("attempt-1", true), { duplicate: false, cleanup: false });
  assert.deepEqual(lifecycle.registerAgentComplete("attempt-1"), { cleanup: true });
});

test("retiene la correlación cuando AgentComplete llega antes que Hangup", () => {
  const lifecycle = new AttemptEventLifecycle();
  assert.deepEqual(lifecycle.registerAgentComplete("attempt-2"), { cleanup: false });
  assert.deepEqual(lifecycle.registerHangup("attempt-2", true), { duplicate: false, cleanup: true });
});

test("ignora el segundo Hangup del mismo bridge", () => {
  const lifecycle = new AttemptEventLifecycle();
  assert.deepEqual(lifecycle.registerHangup("attempt-3", true), { duplicate: false, cleanup: false });
  assert.deepEqual(lifecycle.registerHangup("attempt-3", true), { duplicate: true, cleanup: false });
});

test("una llamada nunca bridgeada se puede limpiar en Hangup", () => {
  const lifecycle = new AttemptEventLifecycle();
  assert.deepEqual(lifecycle.registerHangup("attempt-4", false), { duplicate: false, cleanup: true });
});
