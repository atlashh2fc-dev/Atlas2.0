import assert from "node:assert/strict";
import test from "node:test";
import { originateFailureEvent } from "./originateOutcome";

test("un Originate que sonó hasta el timeout es no_answer, no una falla técnica", () => {
  assert.equal(originateFailureEvent("3"), "no_answer");
  assert.equal(originateFailureEvent(3), "no_answer");
  assert.equal(originateFailureEvent(" 3 "), "no_answer");
});

test("ocupado se distingue; congestión y canal no creado quedan como falla", () => {
  assert.equal(originateFailureEvent("5"), "busy");
  assert.equal(originateFailureEvent("8"), "failed");
  assert.equal(originateFailureEvent("0"), "failed");
  assert.equal(originateFailureEvent(undefined), "failed");
  assert.equal(originateFailureEvent(null), "failed");
  assert.equal(originateFailureEvent(""), "failed");
  assert.equal(originateFailureEvent("x"), "failed");
});
