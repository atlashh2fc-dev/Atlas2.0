import assert from "node:assert/strict";
import { test } from "node:test";

import { CALL_REASONS } from "../src/lib/call-typification.ts";
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

test("clasifica por lo que el cierre dejo grabado, no por el texto del motivo", () => {
  // Tipificaciones de una cartera de cobranza: ninguna esta en el catalogo
  // comercial, pero el workflow ya declaro su desenlace al cerrar la llamada.
  const { groups } = groupTipificationsByResult([
    { reason: "CONVENIO SUSCRITO", count: 111, status: "connected", outcome: "sale" },
    { reason: "COMPROMISO DE PAGO", count: 181, status: "connected", outcome: "callback" },
    { reason: "SIN CAPACIDAD DE PAGO", count: 67, status: "connected", outcome: "not_interested" },
    { reason: "TELEFONO OCUPADO", count: 394, status: "busy", outcome: "other" },
  ]);

  assert.deepEqual(
    groups.map((g) => [g.result, g.count]),
    [
      ["INTERESADO", 292],
      ["NO INTERESADO", 67],
      ["NO CONTACTO", 394],
    ],
  );
});

test("una gestion efectiva sin desenlace declarado cae al catalogo", () => {
  const { groups } = groupTipificationsByResult([
    // El workflow no la clasifico, pero el catalogo comercial si.
    { reason: "NO CALIFICA", count: 5, status: "connected", outcome: "other" },
  ]);
  assert.deepEqual(groups.map((g) => g.result), ["NO INTERESADO"]);
});

test("una gestion efectiva que ni el workflow ni el catalogo clasifican queda sin clasificar", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "SEGUIMIENTO DE CONVENIO", count: 145, status: "connected", outcome: "other" },
  ]);
  assert.deepEqual(groups.map((g) => g.result), [UNCLASSIFIED_RESULT]);
});

test("sin status ni outcome se comporta igual que antes", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "COTIZACION ENVIADA", count: 3 },
    { reason: "NO CALIFICA", count: 2 },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.result, g.count]),
    [
      ["INTERESADO", 3],
      ["NO INTERESADO", 2],
    ],
  );
});

test("el catalogo manda sobre el desenlace en los motivos que ya conoce", () => {
  // "No es el momento" se cierra como callback, igual que "Volver a llamar",
  // pero el negocio lo cuenta como NO INTERESADO. Si el desenlace mandara,
  // pasaria a INTERESADO y cambiaria un numero que hoy es correcto.
  const config = CALL_REASONS.find((r) => r.value === "NO ES EL MOMENTO");
  assert.ok(config, "el motivo tiene que seguir existiendo en el catalogo");
  assert.equal(config.outcome, "callback");
  assert.equal(config.resultLabel, "NO INTERESADO");

  const { groups } = groupTipificationsByResult([
    { reason: "NO ES EL MOMENTO", count: 9, status: config.status, outcome: config.outcome },
  ]);
  assert.deepEqual(groups.map((g) => g.result), ["NO INTERESADO"]);
});

test("para cada motivo del catalogo el desenlace no cambia su grupo", () => {
  // El resto del catalogo si tiene que ser coherente: si alguien agrega un
  // motivo cuyo (status, outcome) contradiga su resultLabel, este test lo caza
  // y obliga a decidirlo a mano, como se decidio "No es el momento".
  const divergentes = CALL_REASONS.filter((reason) => {
    const porCierre = groupTipificationsByResult([
      { reason: "MOTIVO QUE EL CATALOGO NO CONOCE", count: 1, status: reason.status, outcome: reason.outcome },
    ]).groups[0].result;
    return porCierre !== UNCLASSIFIED_RESULT && porCierre !== reason.resultLabel;
  }).map((r) => r.value);

  assert.deepEqual(divergentes, ["NO ES EL MOMENTO"]);
});

test("lo que declara el nodo del workflow manda sobre todo lo demas", () => {
  // Cartera de cobranza: el administrador declaro que "Sin acuerdo" es no
  // interesado y "Seguimiento" es interesado. Ambas gestiones fueron efectivas
  // y su desenlace quedo en `other`, asi que sin la declaracion caerian en
  // sin clasificar, que es lo que pasaba antes.
  const { groups } = groupTipificationsByResult([
    { reason: "DERIVADO A COBRANZA PREJUDICIAL", count: 90, status: "connected", outcome: "other", declaredResult: "no_interesado" },
    { reason: "SEGUIMIENTO DE CONVENIO", count: 145, status: "connected", outcome: "other", declaredResult: "interesado" },
  ]);

  assert.deepEqual(
    groups.map((g) => [g.result, g.count]),
    [
      ["INTERESADO", 145],
      ["NO INTERESADO", 90],
    ],
  );
});

test("una declaracion desconocida no rompe ni se cuela como grupo", () => {
  const { groups } = groupTipificationsByResult([
    { reason: "MOTIVO RARO", count: 4, declaredResult: "vaya_uno_a_saber" },
  ]);
  assert.deepEqual(groups.map((g) => g.result), [UNCLASSIFIED_RESULT]);
});
