import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNCLASSIFIED_RESULT,
  groupTipificationsByResult,
  tipificationExportRows,
} from "../src/lib/tipification-breakdown.ts";

test("separa interesa de no interesa usando la cascada de cierre", () => {
  const { total, groups } = groupTipificationsByResult([
    { reason: "COTIZACION ENVIADA", count: 12 },
    { reason: "NO CALIFICA", count: 30 },
    { reason: "VENTA EN VALIDACION", count: 8 },
    { reason: "TELEFONO FUERA DE SERVICIO", count: 50 },
  ]);

  assert.equal(total, 100);
  assert.deepEqual(
    groups.map((g) => [g.result, g.count]),
    [
      ["INTERESADO", 20],
      ["NO INTERESADO", 30],
      ["NO CONTACTO", 50],
    ],
  );
  assert.equal(groups[0].share, 20);
});

test("los motivos de un workflow propio no se cuentan como interés", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "COMPROMISO DE PAGO", count: 5 },
    { reason: "NO CALIFICA", count: 1 },
  ]);

  const unclassified = groups.find((g) => g.result === UNCLASSIFIED_RESULT);
  assert.ok(unclassified, "el motivo desconocido necesita su propio grupo");
  assert.equal(unclassified.count, 5);
  assert.equal(unclassified.reasons[0].label, "Compromiso de pago");
  // Nunca se mezcla con un resultado conocido.
  assert.equal(groups.find((g) => g.result === "INTERESADO"), undefined);
});

test("un resultado desconocido se ordena al final, nunca antes de los conocidos", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "MOTIVO INVENTADO", count: 900 },
    { reason: "NO CALIFICA", count: 1 },
  ]);

  assert.deepEqual(
    groups.map((g) => g.result),
    ["NO INTERESADO", UNCLASSIFIED_RESULT],
  );
});

test("suma los repetidos y ordena cada grupo de mayor a menor", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "SE ENVIA INFORMACION", count: 2 },
    { reason: "COTIZACION ENVIADA", count: 9 },
    { reason: "SE ENVIA INFORMACION", count: 3 },
  ]);

  const interesado = groups[0];
  assert.equal(interesado.count, 14);
  assert.deepEqual(
    interesado.reasons.map((r) => [r.reason, r.count]),
    [
      ["COTIZACION ENVIADA", 9],
      ["SE ENVIA INFORMACION", 5],
    ],
  );
  // El porcentaje del detalle es sobre su propio resultado, no sobre el total.
  assert.equal(Math.round(interesado.reasons[0].share), 64);
});

test("descarta datos sucios en vez de caerse o inventar gestiones", () => {
  const { total, groups } = groupTipificationsByResult([
    { reason: "NO CALIFICA", count: 4 },
    { reason: "COTIZACION ENVIADA", count: 0 },
    { reason: "SE ENVIA INFORMACION", count: -7 },
    { reason: "  ", count: 99 },
    { reason: "VENTA EN VALIDACION", count: Number.NaN },
  ]);

  assert.equal(total, 4);
  assert.deepEqual(groups.map((g) => g.result), ["NO INTERESADO"]);
});

test("sin gestiones el desglose queda vacio y no divide por cero", () => {
  const breakdown = groupTipificationsByResult([]);
  assert.equal(breakdown.total, 0);
  assert.deepEqual(breakdown.groups, []);
  assert.deepEqual(tipificationExportRows(breakdown), []);
});

test("la exportacion lleva el resultado resuelto en cada fila", () => {
  const rows = tipificationExportRows(
    groupTipificationsByResult([
      { reason: "COTIZACION ENVIADA", count: 1 },
      { reason: "NO CALIFICA", count: 3 },
    ]),
  );

  assert.deepEqual(rows, [
    { Resultado: "INTERESADO", "Tipificación": "Cotizacion enviada", Cantidad: 1, "% del resultado": 100, "% del total": 25 },
    { Resultado: "NO INTERESADO", "Tipificación": "No califica", Cantidad: 3, "% del resultado": 100, "% del total": 75 },
  ]);
});
