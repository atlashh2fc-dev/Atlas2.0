import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChilePhone } from "../src/lib/chile-phone.ts";

test("normaliza móviles chilenos a E.164", () => {
  assert.equal(normalizeChilePhone("+56 9 2843 3242"), "+56928433242");
  assert.equal(normalizeChilePhone("9 2843 3242"), "+56928433242");
  assert.equal(normalizeChilePhone("0056 9 2843 3242"), "+56928433242");
});

test("normaliza teléfonos fijos chilenos", () => {
  assert.equal(normalizeChilePhone("2 2345 6789"), "+56223456789");
  assert.equal(normalizeChilePhone("2345 6789"), "+56223456789");
});

test("rechaza números que no son chilenos o están incompletos", () => {
  assert.throws(() => normalizeChilePhone("12345"), /teléfono chileno válido/);
  assert.throws(() => normalizeChilePhone("+1 212 555 0100"), /teléfono chileno válido/);
});
