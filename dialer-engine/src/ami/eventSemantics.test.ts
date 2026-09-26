import assert from "node:assert/strict";
import test from "node:test";
import {
  hangupCauseToStatus,
  normalizeAmiUniqueId,
  normalizeCallDisconnectParty,
  normalizeQueueTalkSeconds,
  originateResponseMeansCustomerAnswered,
  outboundHangupEvent,
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

/**
 * Recorre una llamada como la ve el router: OriginateResponse, AgentConnect
 * opcional, AMD opcional y el primer Hangup (causa 16, la de siempre).
 */
function simulate(params: {
  success?: boolean;
  personalCallback?: { customerDialStatus?: string | null } | null;
  agentConnect?: boolean;
  amdMachine?: boolean;
  cause?: string;
}) {
  const state = { answered: false, bridged: false };
  if (
    originateResponseMeansCustomerAnswered({
      success: params.success ?? true,
      personalCallback: Boolean(params.personalCallback),
    })
  ) {
    state.answered = true;
  }
  if (params.agentConnect) state.bridged = true;
  return {
    answeredOnOriginate: state.answered,
    event: outboundHangupEvent({
      voicemail: params.amdMachine === true,
      personalCallback: params.personalCallback ?? null,
      answered: state.answered,
      bridged: state.bridged,
      cause: params.cause ?? "16",
    }),
  };
}

test("en el pool, OriginateResponse Success es que el cliente contestó", () => {
  assert.equal(originateResponseMeansCustomerAnswered({ success: true, personalCallback: false }), true);
  assert.equal(originateResponseMeansCustomerAnswered({ success: false, personalCallback: false }), false);
});

test("pool contestado que cuelga sin AgentConnect es abandono, no 'completed' causa 16", () => {
  assert.deepEqual(simulate({}), { answeredOnOriginate: true, event: "abandoned" });
  // La causa SIP no importa: se le dejó esperando igual.
  assert.equal(simulate({ cause: "0" }).event, "abandoned");
  assert.equal(simulate({ cause: "31" }).event, "abandoned");
});

test("pool con AgentConnect no es abandono: manda la causa SIP como antes", () => {
  assert.equal(simulate({ agentConnect: true }).event, "completed");
  assert.equal(simulate({ agentConnect: true, cause: "31" }).event, "failed");
});

test("pool que no contestó sigue con la causa SIP", () => {
  assert.deepEqual(simulate({ success: false, cause: "19" }), { answeredOnOriginate: false, event: "no_answer" });
  assert.equal(simulate({ success: false, cause: "17" }).event, "busy");
});

test("AMD MACHINE gana sobre el abandono", () => {
  assert.equal(simulate({ amdMachine: true }).event, "voicemail");
  assert.equal(simulate({ amdMachine: true, agentConnect: true }).event, "voicemail");
});

test("en una agenda personal el Success es del ejecutivo: no marca contestado ni abandono", () => {
  assert.equal(originateResponseMeansCustomerAnswered({ success: true, personalCallback: true }), false);
  const noContesto = simulate({ personalCallback: { customerDialStatus: "NOANSWER" } });
  assert.deepEqual(noContesto, { answeredOnOriginate: false, event: "no_answer" });
  assert.equal(simulate({ personalCallback: { customerDialStatus: null } }).event, "failed");
  // Con conversación (DialEnd ANSWER deja bridged) sigue 'completed'.
  assert.equal(simulate({ personalCallback: { customerDialStatus: "ANSWER" }, agentConnect: true }).event, "completed");
  // Y el buzón de AMD, si lo hubiera, sigue ganando.
  assert.equal(simulate({ personalCallback: { customerDialStatus: null }, amdMachine: true }).event, "voicemail");
});

test("la causa Q.850 se traduce igual que antes", () => {
  assert.equal(hangupCauseToStatus("16"), "completed");
  assert.equal(hangupCauseToStatus(17), "busy");
  assert.equal(hangupCauseToStatus("18"), "no_answer");
  assert.equal(hangupCauseToStatus("19"), "no_answer");
  assert.equal(hangupCauseToStatus(undefined), "failed");
});
