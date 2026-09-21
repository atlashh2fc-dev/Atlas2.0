import assert from "node:assert/strict";
import { test } from "node:test";

import { costoDeReceta, resumenMateriales, totalAtencion, totalesMateriales, type Insumo, type Procedimiento } from "../src/lib/arancel.ts";

const insumo = (id: string, costo: number, precio: number | null): Insumo => ({
  id,
  codigo: id,
  nombre: id,
  categoria: null,
  unidad: "unidad",
  costo,
  precio_venta: precio,
  cobrable: precio !== null,
  stock: null,
  stock_minimo: null,
  activo: true,
});

const catalogo = new Map([
  ["anestesia", insumo("anestesia", 900, null)],
  ["injerto", insumo("injerto", 90000, 150000)],
]);

test("los materiales suman costo siempre y cobro solo si se cobran", () => {
  assert.deepEqual(
    totalesMateriales(
      [
        { insumo_id: "anestesia", cantidad: 2, cobrar: true },
        { insumo_id: "injerto", cantidad: 1, cobrar: true },
      ],
      catalogo,
    ),
    { costo: 91800, cobro: 150000 },
  );
  assert.deepEqual(totalesMateriales([{ insumo_id: "injerto", cantidad: 1, cobrar: false }], catalogo), { costo: 90000, cobro: 0 });
  assert.deepEqual(totalesMateriales([{ insumo_id: "no-existe", cantidad: 3, cobrar: true }], catalogo), { costo: 0, cobro: 0 });
});

test("la receta del procedimiento da su costo", () => {
  const procedimiento = { receta: [{ insumo_id: "anestesia", cantidad: 3 }] } as Procedimiento;
  assert.deepEqual(costoDeReceta(procedimiento, catalogo), { costo: 2700, cobro: 0 });
});

test("el total de una atención incluye los materiales cobrados", () => {
  assert.equal(totalAtencion({ precio: 450000, precio_materiales: 150000 }), 600000);
  assert.equal(totalAtencion({ precio: 45000 }), 45000);
  assert.equal(
    resumenMateriales([{ nombre: "Resina", unidad: "porción", cantidad: 2, costo_unitario: 2500, precio_unitario: null, cobrado: false }]),
    "Resina ×2",
  );
});
