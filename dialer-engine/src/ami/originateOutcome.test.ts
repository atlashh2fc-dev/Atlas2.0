import assert from "node:assert/strict";
import test from "node:test";
import { dialAttemptIdFromChanVariable, originateFailureEvent } from "./originateOutcome";

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

test("con Reason 0 manda la causa Q.850 que respondió el carrier", () => {
  // 480 Temporarily unavailable (celular apagado / sin cobertura).
  assert.equal(originateFailureEvent("0", "19"), "no_answer");
  assert.equal(originateFailureEvent("0", "18"), "no_answer");
  assert.equal(originateFailureEvent("0", "20"), "no_answer");
  assert.equal(originateFailureEvent("0", " 17 "), "busy");
  // 404 (número inexistente) y 403 (rechazo) quedan 'failed' con su causa:
  // la base los clasifica, no el motor.
  assert.equal(originateFailureEvent("0", "1"), "failed");
  assert.equal(originateFailureEvent("0", "21"), "failed");
  assert.equal(originateFailureEvent("0", "34"), "failed");
  assert.equal(originateFailureEvent("0", null), "failed");
  // Reason 3/5 no cambian por la causa.
  assert.equal(originateFailureEvent("3", "21"), "no_answer");
  assert.equal(originateFailureEvent("5", "1"), "busy");
});

test("lee el DIAL_ATTEMPT_ID del channelvar del AMI", () => {
  const id = "3bed01a8-69ad-440a-816a-d8246a1fe304";
  assert.equal(dialAttemptIdFromChanVariable(`DIAL_ATTEMPT_ID=${id}`), id);
  assert.equal(dialAttemptIdFromChanVariable([`OTRA=1`, ` DIAL_ATTEMPT_ID=${id.toUpperCase()} `]), id);
  assert.equal(dialAttemptIdFromChanVariable("DIAL_ATTEMPT_ID="), undefined);
  assert.equal(dialAttemptIdFromChanVariable(undefined), undefined);
  assert.equal(dialAttemptIdFromChanVariable("DIAL_ATTEMPT_ID=no-es-uuid"), undefined);
});

test("acepta el objeto en que asterisk-manager convierte ChanVariable", () => {
  // Así llega en producción: la librería parte "NOMBRE=valor" en un objeto.
  const id = "6e100b5e-1234-4abc-8def-0123456789ab";
  assert.equal(dialAttemptIdFromChanVariable({ DIAL_ATTEMPT_ID: id }), id);
  assert.equal(dialAttemptIdFromChanVariable({ dial_attempt_id: id.toUpperCase() }), id);
  assert.equal(dialAttemptIdFromChanVariable({ OTRA: "1" }), undefined);
  assert.equal(dialAttemptIdFromChanVariable({ DIAL_ATTEMPT_ID: "" }), undefined);
});
