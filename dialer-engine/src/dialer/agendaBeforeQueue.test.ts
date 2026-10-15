import assert from "node:assert/strict";
import test from "node:test";
import { deliverAgendaBeforeQueue } from "./agendaBeforeQueue";

const CLAUDIA = "0cc57ec2-0000-4000-8000-000000000000";
const EQUIFAX = "318cf37a-da42-4cbd-934d-bdc47753d7bd";
const IMAGEN = "111cb0ed-0000-4000-8000-000000000000";

test("con agenda vencida no vuelve a la cola: le suena su agenda", async () => {
  const asked: string[] = [];
  const keepOut = await deliverAgendaBeforeQueue(CLAUDIA, [EQUIFAX], async (campaignId) => {
    asked.push(campaignId);
    return true;
  });
  assert.equal(keepOut, true);
  assert.deepEqual(asked, [EQUIFAX]);
});

test("sin agenda vencida vuelve a la cola como siempre", async () => {
  assert.equal(await deliverAgendaBeforeQueue(CLAUDIA, [EQUIFAX], async () => false), false);
  assert.equal(await deliverAgendaBeforeQueue(CLAUDIA, [], async () => true), false);
});

test("con dos campañas se detiene en la primera que entrega", async () => {
  const asked: string[] = [];
  const keepOut = await deliverAgendaBeforeQueue(CLAUDIA, [EQUIFAX, IMAGEN], async (campaignId) => {
    asked.push(campaignId);
    return campaignId === EQUIFAX;
  });
  assert.equal(keepOut, true);
  assert.deepEqual(asked, [EQUIFAX]);
});

test("un error al pedir la agenda no deja al ejecutivo fuera de la cola", async () => {
  const errors: string[] = [];
  const keepOut = await deliverAgendaBeforeQueue(
    CLAUDIA,
    [EQUIFAX, IMAGEN],
    async (campaignId) => {
      if (campaignId === EQUIFAX) throw new Error("claim_due_personal_callbacks: timeout");
      return false;
    },
    (_err, campaignId) => errors.push(campaignId)
  );
  assert.equal(keepOut, false);
  assert.deepEqual(errors, [EQUIFAX]);
});

test("evento y sync a la vez: el segundo no lo despausa mientras el primero decide", async () => {
  let finish!: (delivered: boolean) => void;
  const first = deliverAgendaBeforeQueue(
    CLAUDIA,
    [EQUIFAX],
    () => new Promise<boolean>((resolve) => (finish = resolve))
  );
  let secondAsked = false;
  const second = await deliverAgendaBeforeQueue(CLAUDIA, [EQUIFAX], async () => {
    secondAsked = true;
    return false;
  });
  assert.equal(second, true);
  assert.equal(secondAsked, false);

  finish(false);
  assert.equal(await first, false);
  // Terminada la consulta, la siguiente vuelve a preguntar.
  assert.equal(await deliverAgendaBeforeQueue(CLAUDIA, [EQUIFAX], async () => true), true);
});
