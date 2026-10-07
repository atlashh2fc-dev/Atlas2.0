// Plantillas de WhatsApp aprobadas por Meta.
//
// Si esto se rompe, un recordatorio sale como texto libre fuera de las 24
// horas y Meta lo rechaza, una plantilla viaja con parámetros vacíos (Meta
// la rechaza), o un nombre cambia y deja de coincidir con el aprobado.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dentroDeVentana, parametrosDePlantillaMeta, PLANTILLAS_META } from "../src/lib/mensajes/plantillas-meta.ts";
import { PLANTILLAS } from "../src/lib/mensajes/plantillas.ts";

const despacho = readFileSync(new URL("../src/lib/mensajes/despachar.ts", import.meta.url), "utf8");
const doc = readFileSync(new URL("../docs/whatsapp-plantillas-meta.md", import.meta.url), "utf8");

test("cada plantilla de Meta tiene nombre válido, variables en orden y ejemplo completo", () => {
  for (const [clave, plantilla] of Object.entries(PLANTILLAS_META)) {
    assert.ok(clave in PLANTILLAS, `${clave} existe en Atlas`);
    assert.match(plantilla.nombre, /^[a-z0-9_]+_v\d+$/);
    const marcas = [...plantilla.cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((marca) => Number(marca[1]));
    assert.deepEqual(marcas, plantilla.variables.map((_, indice) => indice + 1), `${clave}: {{n}} en orden`);
    assert.equal(plantilla.ejemplo.length, plantilla.variables.length);
    // Meta no acepta una plantilla que empieza o termina con una variable.
    assert.ok(!plantilla.cuerpo.trim().startsWith("{{"), `${clave} no empieza con variable`);
    assert.ok(!/\{\{\d+\}\}[.\s]*$/.test(plantilla.cuerpo), `${clave} no termina con variable`);
    assert.ok(doc.includes(plantilla.nombre), `${plantilla.nombre} está en el documento para Meta`);
  }
});

test("los parámetros salen en orden, con derivadas y nunca vacíos", () => {
  const parametros = parametrosDePlantillaMeta("cita_confirmar", { nombre: "Camila", hora: "10:30", profesional: "Dra. Vidal", clinica: "Sonríe", mascota: "Luna" });
  assert.deepEqual(parametros, ["Camila", "la hora de Luna", "mañana", "10:30", "Dra. Vidal", "Sonríe"]);
  assert.deepEqual(parametrosDePlantillaMeta("control", { nombre: "Ana", clinica: "Sonríe" }), ["Ana", "Sonríe", "-"]);
  assert.equal(parametrosDePlantillaMeta("libre", {}), null);
});

test("la ventana de 24 horas se mide desde el último mensaje de la persona", () => {
  const ahora = new Date("2026-10-08T12:00:00Z");
  assert.equal(dentroDeVentana(null, ahora), false);
  assert.equal(dentroDeVentana("2026-10-08T01:00:00Z", ahora), true);
  assert.equal(dentroDeVentana("2026-10-07T11:00:00Z", ahora), false);
});

test("el despacho usa plantilla fuera de la ventana y si no la hay pasa a correo", () => {
  assert.match(despacho, /dentroDeVentana\(conversacion\?\.last_inbound_at/);
  assert.match(despacho, /aprobadas\.includes\(definicion\.nombre\)/);
  assert.match(despacho, /sendWhatsAppTemplate/);
  assert.match(despacho, /envio\.fueraDeVentana/);
  assert.match(despacho, /canal: "correo", destinatario: correo/);
});
