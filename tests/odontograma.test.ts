// Odontograma: numeración FDI, dentición por edad e historia por pieza.
//
// Si esto se rompe, un niño aparece con 32 piezas, una caries nueva borra la
// obturación antigua de otra cara, o el visor pinta una pieza que no existe.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  denticionPorEdad,
  estadoActual,
  piezaPorNumero,
  piezasDe,
  superficiesVigentes,
  type RegistroOdontograma,
} from "../src/lib/odontograma.ts";

const registro = (pieza: number, estado: RegistroOdontograma["estado"], fecha: string, superficies: string[] = []): RegistroOdontograma => ({
  id: `${pieza}-${estado}-${fecha}`,
  pieza,
  estado,
  avance: "terminado",
  superficies,
  sintoma: null,
  diagnostico: null,
  tratamiento: null,
  profesional: null,
  nota: null,
  fecha,
  created_at: `${fecha}T12:00:00Z`,
});

test("adulto tiene 32 piezas FDI y niño 20 temporales", () => {
  const adulto = piezasDe("permanente").map((pieza) => pieza.numero);
  const nino = piezasDe("temporal").map((pieza) => pieza.numero);
  assert.equal(adulto.length, 32);
  assert.equal(nino.length, 20);
  assert.ok(adulto.includes(11) && adulto.includes(48) && !adulto.includes(19));
  assert.ok(nino.includes(51) && nino.includes(85) && !nino.includes(56));
  assert.equal(piezaPorNumero(36)?.tipo, "molar");
  assert.equal(piezaPorNumero(13)?.tipo, "canino");
  assert.equal(piezaPorNumero(24)?.superior, true);
  assert.equal(piezaPorNumero(44)?.superior, false);
  assert.equal(piezaPorNumero(75)?.temporal, true);
  assert.equal(piezaPorNumero(19), null);
});

test("la dentición sale de la edad: temporal antes de los 12", () => {
  const hoy = new Date("2026-09-21T12:00:00Z");
  assert.equal(denticionPorEdad("2019-05-01", hoy), "temporal");
  assert.equal(denticionPorEdad("2010-05-01", hoy), "permanente");
  assert.equal(denticionPorEdad(null, hoy), "permanente");
});

test("el estado de una pieza es su último registro y la historia se conserva", () => {
  const registros = [
    registro(36, "caries", "2026-01-10", ["O"]),
    registro(36, "ausente", "2026-03-01"),
    registro(36, "implante", "2026-09-01"),
  ];
  assert.equal(estadoActual(registros).get(36)?.estado, "implante");
});

test("una caries nueva en mesial no borra la obturación antigua en oclusal", () => {
  const registros = [
    registro(16, "obturacion", "2025-02-01", ["O"]),
    registro(16, "caries", "2026-09-01", ["M"]),
  ];
  const vigentes = superficiesVigentes(registros, 16);
  assert.equal(vigentes.get("O"), "obturacion");
  assert.equal(vigentes.get("M"), "caries");
});

test("la base y la aplicación aceptan los mismos estados y superficies", () => {
  const nombre = readdirSync(new URL("../supabase/migrations", import.meta.url)).find((archivo) => archivo.endsWith("_odontograma.sql"));
  const migracion = readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");
  const catalogo = readFileSync(new URL("../src/lib/odontograma.ts", import.meta.url), "utf8");
  for (const estado of ["sano", "caries", "fractura", "obturacion", "sellante", "endodoncia", "corona", "implante", "protesis", "extraccion_indicada", "ausente"]) {
    assert.match(migracion, new RegExp(`'${estado}'`));
    assert.match(catalogo, new RegExp(`"${estado}"`));
  }
  assert.match(migracion, /superficies <@ array\['O', 'M', 'D', 'V', 'L'\]/);
  // Historia de salud: se agrega, no se edita ni se borra desde la aplicación.
  assert.doesNotMatch(migracion, /for (update|delete|all) to authenticated\s+using \(\(select public\.current_role_name/);
});
