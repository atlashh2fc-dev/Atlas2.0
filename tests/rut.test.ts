import assert from "node:assert/strict";
import test from "node:test";
import { compactRut, formatRut, isValidRut, rutCheckDigit } from "../src/lib/rut.ts";

test("el dígito verificador sale del módulo 11, con K y 0", () => {
  assert.equal(rutCheckDigit("76150794"), "K");
  assert.equal(rutCheckDigit("76590622"), "9");
  assert.equal(rutCheckDigit("11111111"), "1");
  assert.equal(rutCheckDigit("12345675"), "0");
  assert.equal(rutCheckDigit("12345678"), "5");
});

test("acepta el RUT escrito de cualquier forma y rechaza el mal digitado", () => {
  for (const rut of ["76.150.794-K", "76150794k", "76.150.794 - k", " 7615 0794K ", "1.111.111-4"]) {
    assert.equal(isValidRut(rut), true, rut);
  }
  for (const rut of ["76.150.794-1", "", "K", "123", "0.000.000-0", "123456789-0", "76.150.794"]) {
    assert.equal(isValidRut(rut), false, rut);
  }
});

test("se guarda con el formato de las bases para que el cruce lo encuentre", () => {
  assert.equal(formatRut("76150794k"), "76.150.794-K");
  assert.equal(formatRut("11111111-1"), "11.111.111-1");
  assert.equal(formatRut("1111111-4"), "1.111.111-4");
  assert.equal(compactRut("76.150.794-k"), "76150794K");
  assert.throws(() => formatRut("76.150.794-1"), /dígito verificador/);
});
