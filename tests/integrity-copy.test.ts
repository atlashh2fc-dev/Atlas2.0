import assert from "node:assert/strict";
import { test } from "node:test";

import { explainIntegrityCase, formatSeconds, integrityMotiveLabel } from "../src/lib/integrity-copy.ts";

const base = { handle_seconds: 80, seconds_since_previous: 120 };

test("cada caso dice qué no calza entre la tipificación y la central", () => {
  assert.equal(
    explainIntegrityCase({ ...base, motivo: "contacto_sin_conexion", ultimo_intento: null }),
    "Tipificó contacto, pero la central no registra ninguna llamada a este cliente.",
  );
  assert.equal(
    explainIntegrityCase({ ...base, motivo: "contacto_sin_conexion", ultimo_intento: "no_answer" }),
    "Tipificó contacto, pero la central marcó: no contestó.",
  );
  assert.equal(
    explainIntegrityCase({ ...base, motivo: "contacto_sin_conexion", ultimo_intento: "estado_nuevo" }),
    "Tipificó contacto, pero la central marcó: sin conexión.",
  );
  assert.equal(
    explainIntegrityCase({ ...base, handle_seconds: 4.2, motivo: "cierre_rapido", ultimo_intento: "completed" }),
    "Cerró un contacto en 4 s: no alcanza para una conversación.",
  );
  assert.equal(
    explainIntegrityCase({ ...base, seconds_since_previous: 2.9, motivo: "rafaga", ultimo_intento: null }),
    "Cerró 3 s después de su gestión anterior.",
  );
});

test("las duraciones se leen como las diría una persona", () => {
  assert.equal(formatSeconds(null), "—");
  assert.equal(formatSeconds(12.4), "12 s");
  assert.equal(formatSeconds(60), "1 min");
  assert.equal(formatSeconds(135.6), "2 min 16 s");
});

test("las etiquetas no usan jerga", () => {
  assert.equal(integrityMotiveLabel("contacto_sin_conexion"), "Contacto sin respaldo");
  assert.equal(integrityMotiveLabel("cierre_rapido"), "Contacto de segundos");
  assert.equal(integrityMotiveLabel("rafaga"), "Cierre en ráfaga");
});
