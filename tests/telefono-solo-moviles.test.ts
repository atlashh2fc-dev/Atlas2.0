// El teléfono marca solo móviles chilenos. Un fijo pegado en el marcador no
// puede convertirse en el móvil de otra persona.

import assert from "node:assert/strict";
import test from "node:test";

import { isNonMobilePhone, subscriberFromPhone } from "../src/components/phone/format.ts";

test("los formatos de un móvil llegan a los mismos ocho dígitos", () => {
  for (const pegado of ["981406609", "56981406609", "+56 9 8140 6609", "0056981406609", "8140 6609"]) {
    assert.equal(subscriberFromPhone(pegado), "81406609", pegado);
  }
});

test("un fijo no se recorta a un móvil ajeno", () => {
  for (const fijo of ["+56 2 2345 6789", "56223456789", "223456789", "+56 32 234 5678"]) {
    assert.equal(subscriberFromPhone(fijo), "", fijo);
    assert.equal(isNonMobilePhone(fijo), true, fijo);
  }
});

test("mientras se escribe no se acusa de fijo", () => {
  assert.equal(isNonMobilePhone("8140"), false);
  assert.equal(subscriberFromPhone("8140"), "8140");
});
