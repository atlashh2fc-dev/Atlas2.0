import assert from "node:assert/strict";
import test from "node:test";
import { toChileE164 } from "./client";

test("toChileE164 normaliza móviles chilenos", () => {
  assert.equal(toChileE164("9 1234 5678"), "+56912345678");
  assert.equal(toChileE164("+56 9 1234 5678"), "+56912345678");
});

test("toChileE164 normaliza fijos antiguos de Santiago", () => {
  assert.equal(toChileE164("2345 6789"), "+56223456789");
});

test("toChileE164 rechaza un destino vacío", () => {
  assert.equal(toChileE164(" - "), "");
});
