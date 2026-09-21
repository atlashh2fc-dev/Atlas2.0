// Mapa clínico de la mascota: razas, zonas y etapas de vida.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { REGIONES, RAZAS, aniosDe, etapaDe, razaDe, razasDe } from "../src/lib/anatomia.ts";

test("hay razas de perro y de gato, y lo desconocido cae en el mestizo de su especie", () => {
  assert.ok(razasDe("Perro").length >= 8);
  assert.ok(razasDe("Gato").length >= 4);
  assert.equal(razaDe("Perro", "Beagle").nombre, "Beagle");
  assert.equal(razaDe("Gato", "Beagle").nombre, "Mestizo");
  assert.equal(razaDe("Gato", "Beagle").especie, "Gato");
  assert.equal(razaDe(null, null).especie, "Perro");
  // Cada raza tiene un nombre único dentro de su especie.
  for (const especie of ["Perro", "Gato"] as const) {
    const nombres = razasDe(especie).map((raza) => raza.nombre);
    assert.equal(new Set(nombres).size, nombres.length);
  }
  assert.ok(RAZAS.every((raza) => raza.largo > 0 && raza.patas.largo > 0 && raza.cabeza > 0));
});

test("la etapa de vida cambia con la edad y la especie", () => {
  const hoy = new Date("2026-09-21T12:00:00Z");
  assert.equal(etapaDe("Perro", aniosDe("2026-03-01", hoy)), "cachorro");
  assert.equal(etapaDe("Perro", aniosDe("2020-03-01", hoy)), "adulto");
  assert.equal(etapaDe("Perro", aniosDe("2016-03-01", hoy)), "senior");
  assert.equal(etapaDe("Gato", aniosDe("2016-03-01", hoy)), "adulto");
  assert.equal(etapaDe("Gato", aniosDe("2013-03-01", hoy)), "senior");
});

test("la base y la aplicación aceptan las mismas zonas del cuerpo", () => {
  const nombre = readdirSync(new URL("../supabase/migrations", import.meta.url)).find((archivo) => archivo.endsWith("_mapa_clinico_mascota.sql"));
  const migracion = readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");
  for (const region of REGIONES) assert.match(migracion, new RegExp(`'${region}'`));
  // Es historia clínica: se agrega, no se edita ni se borra desde la aplicación.
  assert.doesNotMatch(migracion, /policy mascota_registros_(update|delete|write)/);
});

test("los estudios quedan en un bucket privado, en la carpeta de su empresa", async () => {
  const nombre = readdirSync(new URL("../supabase/migrations", import.meta.url)).find((archivo) => archivo.endsWith("_estudios_clinicos.sql"));
  const migracion = readFileSync(new URL(`../supabase/migrations/${nombre}`, import.meta.url), "utf8");
  assert.match(migracion, /'estudios-clinicos', 'estudios-clinicos', false/);
  assert.match(migracion, /check \(split_part\(storage_path, '\/', 1\) = organization_id::text\)/);
  assert.match(migracion, /\(storage\.foldername\(name\)\)\[1\] = any \(select unnest\(public\.current_org_ids\(\)\)::text\)/);

  const { nombreSeguro, mimeDe } = await import("../src/lib/estudios.ts");
  assert.equal(nombreSeguro("Radiografía rodilla (1).jpg"), "Radiografia-rodilla-1-.jpg");
  assert.equal(mimeDe("placa.dcm", ""), "application/dicom");
  assert.equal(mimeDe("placa.png", "image/png"), "image/png");
});
