import assert from "node:assert/strict";
import test from "node:test";
import { callerIdPool, pickCallerId } from "./callerId";

const leads = Array.from({ length: 3000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

test("sin lista se usa caller_id tal cual, como antes", () => {
  assert.deepEqual(callerIdPool({ caller_id: "56965906926" }), ["56965906926"]);
  assert.deepEqual(callerIdPool({ caller_id: "56965906926", caller_ids: null }), ["56965906926"]);
  assert.deepEqual(callerIdPool({ caller_id: "56965906926", caller_ids: [] }), ["56965906926"]);
  assert.deepEqual(callerIdPool({ caller_id: "56965906926", caller_ids: ["", "  "] }), ["56965906926"]);
  // El formato del número único no se toca: es el que ya acepta el carrier.
  assert.deepEqual(callerIdPool({ caller_id: "+56 2 0000 1003" }), ["+56 2 0000 1003"]);
  assert.deepEqual(callerIdPool({ caller_id: null }), []);
  assert.deepEqual(callerIdPool({ caller_id: "  " }), []);
  assert.equal(pickCallerId([], leads[0]), null);
});

test("con lista, la lista manda y se limpian vacíos y repetidos", () => {
  assert.deepEqual(
    callerIdPool({ caller_id: "56965906926", caller_ids: ["56911111111", " 56922222222 ", "56911111111", null] }),
    ["56911111111", "56922222222"]
  );
});

test("un solo número: todos los leads salen con ese", () => {
  for (const lead of leads.slice(0, 50)) assert.equal(pickCallerId(["56965906926"], lead), "56965906926");
});

test("el mismo lead sale siempre con el mismo número, sin importar el orden de la lista", () => {
  const pool = ["56911111111", "56922222222", "56933333333"];
  const reversed = [...pool].reverse();
  for (const lead of leads.slice(0, 200)) {
    const first = pickCallerId(pool, lead);
    assert.equal(pickCallerId(pool, lead), first);
    assert.equal(pickCallerId(reversed, lead), first);
  }
});

test("reparte parejo entre leads", () => {
  const pool = ["56911111111", "56922222222", "56933333333", "56944444444"];
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const chosen = pickCallerId(pool, lead)!;
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
  }
  assert.equal(counts.size, pool.length);
  for (const [number, count] of counts) {
    // 750 esperados por número; ±20 % deja margen de sobra al azar.
    assert.ok(count > 600 && count < 900, `${number}: ${count}`);
  }
});

test("quitar un número solo mueve a los leads que lo tenían", () => {
  const pool = ["56911111111", "56922222222", "56933333333", "56944444444"];
  const withoutThird = pool.filter((n) => n !== "56933333333");
  let moved = 0;
  for (const lead of leads) {
    const before = pickCallerId(pool, lead);
    const after = pickCallerId(withoutThird, lead);
    if (before === "56933333333") {
      moved += 1;
      assert.notEqual(after, "56933333333");
    } else {
      assert.equal(after, before, `el lead ${lead} cambió de número sin motivo`);
    }
  }
  assert.ok(moved > 0);
});

test("agregar un número le quita leads a los demás sin barajar el resto", () => {
  const pool = ["56911111111", "56922222222"];
  const withNew = [...pool, "56955555555"];
  for (const lead of leads) {
    const after = pickCallerId(withNew, lead);
    if (after !== "56955555555") assert.equal(after, pickCallerId(pool, lead));
  }
});
