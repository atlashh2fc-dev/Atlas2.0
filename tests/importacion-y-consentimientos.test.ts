// Importar fichas y consentimiento informado.
//
// Si esto se rompe, la importación pone el teléfono en el nombre, duplica
// personas, lee mal las fechas de Excel, o una firma trae código que se
// ejecuta al mostrarla.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { detectarColumnas, filasParaImportar, normalizarTitulo, plantillaCsv } from "../src/lib/importacion.ts";
import { firmaComoSvg, hayFirma, PLANTILLAS_SUGERIDAS } from "../src/lib/consentimientos.ts";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const leer = (sufijo: string) => readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith(sufijo))}`, import.meta.url), "utf8");

test("las columnas se reconocen por su título, con tildes y mayúsculas", () => {
  assert.equal(normalizarTitulo("Teléfono Móvil"), "telefono movil");
  assert.deepEqual(detectarColumnas(["Nombre completo", "Teléfono", "E-mail", "RUT", "Comuna", "Observaciones"], false), ["nombre", "telefono", "correo", "rut", "comuna", "nota"]);
  // En Vet, «Paciente» es la mascota y «Tutor» la persona.
  assert.deepEqual(detectarColumnas(["Tutor", "Celular", "Paciente", "Especie", "Raza"], true), ["nombre", "telefono", "mascota", "especie", "raza"]);
  // Fuera de Vet las columnas de mascota no se asignan.
  assert.deepEqual(detectarColumnas(["Nombre", "Mascota"], false), ["nombre", null]);
  // Un campo va a una sola columna.
  assert.deepEqual(detectarColumnas(["Celular", "Teléfono fijo"], false), ["telefono", null]);
});

test("las filas salen limpias, con fechas de Excel convertidas y sin filas vacías", () => {
  const filas = filasParaImportar(
    [
      ["Camila Rojas", "9 8765 4321", "", 44270],
      ["", "", "", ""],
      ["Pedro Soto", "", "pedro@correo.cl", "15/03/2021"],
    ],
    ["nombre", "telefono", "correo", "nacimiento"],
  );
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { nombre: "Camila Rojas", telefono: "9 8765 4321", nacimiento: "2021-03-15" });
  assert.deepEqual(filas[1], { nombre: "Pedro Soto", correo: "pedro@correo.cl", nacimiento: "2021-03-15" });
  assert.match(plantillaCsv(true), /^Nombre;Celular;Correo;RUT;Comuna;Mascota/);
});

test("la importación no duplica: busca por celular, RUT y correo antes de crear", () => {
  const sql = leer("_importacion_y_consentimientos.sql");
  assert.match(sql, /right\(regexp_replace\(coalesce\(phone, ''\), '\\D', '', 'g'\), 8\) = right\(v_digitos, 8\)/);
  assert.match(sql, /upper\(regexp_replace\(coalesce\(rut, ''\), '\[\^0-9kK\]', '', 'g'\)\) = v_rut_limpio/);
  assert.match(sql, /lower\(btrim\(coalesce\(email, ''\)\)\) = v_correo/);
  assert.match(sql, /Máximo 5\.000 filas/);
  assert.match(sql, /security invoker/);
});

test("la firma es un SVG de puro trazo que la base acepta", () => {
  const trazos = [[{ x: 10, y: 10 }, { x: 20, y: 15 }, { x: 30, y: 12 }, { x: 40, y: 20 }], [{ x: 50, y: 30 }, { x: 60, y: 35 }, { x: 70, y: 32 }, { x: 80, y: 40 }]];
  assert.ok(hayFirma(trazos));
  assert.ok(!hayFirma([[{ x: 1, y: 1 }]]));
  const svg = firmaComoSvg(trazos, 600, 200);
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  const prohibido = /(<script|javascript:|href\s*=|xlink|\son[a-z]+\s*=|<foreignobject|<image|<use|<style)/i;
  assert.doesNotMatch(svg, prohibido);
  // Y la base rechaza lo que trae código.
  const sql = leer("_firma_svg_mas_estricta.sql");
  assert.ok(sql.includes("\\son[a-z]+\\s*="));
  assert.ok(sql.includes("<foreignobject"));
});

test("un consentimiento firmado no se reescribe y el enlace es largo", () => {
  const sql = leer("_importacion_y_consentimientos.sql");
  assert.match(sql, /Un consentimiento firmado no se modifica/);
  assert.match(sql, /length\(coalesce\(p_token, ''\)\) >= 32/);
  assert.match(sql, /grant execute on function public\.firmar_consentimiento_publico\(text, text, text, text\) to anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.firmar_consentimiento_interno\([^)]*\) from public, anon, authenticated;/);
});

test("hay plantillas sugeridas para cada rubro, con las variables que la base reemplaza", () => {
  for (const rubro of ["dental", "vet", "barber"] as const) {
    assert.ok(PLANTILLAS_SUGERIDAS[rubro].length > 0);
    for (const plantilla of PLANTILLAS_SUGERIDAS[rubro]) {
      for (const [, variable] of plantilla.texto.matchAll(/\{\{([a-z]+)\}\}/g)) {
        assert.ok(["nombre", "rut", "mascota", "clinica", "fecha"].includes(variable), `${plantilla.titulo}: {{${variable}}}`);
      }
    }
  }
});
