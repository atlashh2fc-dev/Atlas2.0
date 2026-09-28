import test from "node:test";
import assert from "node:assert/strict";
import { AmiActionTimeoutError, sendAmiAction } from "./sendAction";

type Callback = (err: unknown, res?: unknown) => void;

function fakeAmi(behavior: (cb: Callback) => void) {
  return { action: (_action: unknown, cb: Callback) => behavior(cb) } as never;
}

test("resuelve con la respuesta de AMI", async () => {
  const res = await sendAmiAction(fakeAmi((cb) => cb(null, { Response: "Success" })), { Action: "Ping" });
  assert.deepEqual(res, { Response: "Success" });
});

test("rechaza con el error de AMI", async () => {
  await assert.rejects(
    sendAmiAction(fakeAmi((cb) => cb({ message: "Permission denied" })), { Action: "Originate" }),
    { message: "Permission denied" }
  );
});

test("rechaza si AMI nunca contesta", async () => {
  await assert.rejects(
    sendAmiAction(fakeAmi(() => undefined), { Action: "Originate" }, 20),
    (err) => err instanceof AmiActionTimeoutError && /Originate/.test(err.message)
  );
});

test("una respuesta tardía después del plazo no cambia el resultado", async () => {
  let late: Callback | null = null;
  const pending = sendAmiAction(fakeAmi((cb) => (late = cb)), { Action: "Originate" }, 20);
  await assert.rejects(pending, AmiActionTimeoutError);
  assert.doesNotThrow(() => late?.(null, { Response: "Success" }));
});
