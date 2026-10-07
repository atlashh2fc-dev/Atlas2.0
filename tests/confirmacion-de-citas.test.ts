// La cita se confirma sola y cada clínica escribe con sus palabras.
//
// Si esto se rompe, un «no hay problema» cancela una hora, un texto propio
// con una variable inventada sale con llaves sueltas al paciente, o los
// recordatorios vuelven a salir a medianoche.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { CONFIGURACION_POR_DEFECTO, configuracionDesdeFila, resumenRecordatorio } from "../src/lib/configuracion-agenda.ts";
import { PLANTILLAS, PLANTILLAS_EDITABLES, renderizarPlantilla, validarTextoPropio } from "../src/lib/mensajes/plantillas.ts";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const leer = (sufijo: string) =>
  readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith(sufijo))}`, import.meta.url), "utf8");

test("el recordatorio dice cuándo es la cita y pide responder SÍ o NO", () => {
  const texto = renderizarPlantilla("cita_confirmar", { nombre: "Camila", cuando: "el jueves 09/10", hora: "10:30", profesional: "Dra. Vidal", clinica: "Sonríe", motivo: "Control" });
  assert.match(texto, /el jueves 09\/10 a las 10:30/);
  assert.match(texto, /Responde SÍ/);
  assert.match(texto, /NO si no puedes/);
});

test("un recordatorio viejo, sin «cuando», sigue diciendo mañana", () => {
  const texto = renderizarPlantilla("cita_recordatorio", { nombre: "Camila", hora: "10:30", profesional: "Dra. Vidal", clinica: "Sonríe", motivo: "Control" });
  assert.match(texto, /^Hola Camila, mañana a las 10:30/);
});

test("el texto propio de la clínica reemplaza al de Atlas solo en las plantillas editables", () => {
  const propios = { cita_confirmar: "Hola {{nombre}}! Te esperamos {{cuando}} {{hora}}. ¿Vienes?", libre: "esto no debe usarse {{texto}}" };
  assert.equal(renderizarPlantilla("cita_confirmar", { nombre: "Ana", cuando: "hoy", hora: "18:00" }, propios), "Hola Ana! Te esperamos hoy 18:00. ¿Vienes?");
  assert.equal(renderizarPlantilla("libre", { texto: "Hola" }, propios), "Hola");
  // Un texto propio vacío no deja el mensaje en blanco.
  assert.match(renderizarPlantilla("vacuna", { nombre: "Ana", mascota: "Luna", fecha: "10/10" }, { vacuna: "   " }), /la vacuna de Luna/);
});

test("un texto propio no puede usar datos que el mensaje no tiene", () => {
  assert.equal(validarTextoPropio("cita_confirmar", "Hola {{nombre}}, tu hora es {{cuando}} a las {{hora}}."), null);
  assert.match(validarTextoPropio("cita_confirmar", "Hola {{nombre}}, debes {{monto}}") ?? "", /monto/);
  assert.match(validarTextoPropio("vacuna", "Hola") ?? "", /corto/);
  assert.match(validarTextoPropio("vacuna", "x".repeat(901)) ?? "", /900/);
});

test("todas las variables editables existen en el texto original o se derivan", () => {
  const derivadas = new Set(["de_quien", "mascota_sufijo", "vence_o_vencio", "cuando"]);
  for (const [clave, variables] of Object.entries(PLANTILLAS_EDITABLES)) {
    const original = PLANTILLAS[clave as keyof typeof PLANTILLAS].cuerpo;
    for (const [, nombre] of original.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
      assert.ok(variables.includes(nombre) || derivadas.has(nombre), `${clave}: {{${nombre}}} no está en la lista de variables`);
    }
    assert.equal(validarTextoPropio(clave as keyof typeof PLANTILLAS, original), null, `${clave}: el texto original debe ser válido como texto propio`);
  }
});

test("la configuración de la base se normaliza y tiene valores por defecto", () => {
  assert.deepEqual(configuracionDesdeFila(null), CONFIGURACION_POR_DEFECTO);
  const fila = configuracionDesdeFila({ recordatorio_dias_antes: 2, recordatorio_desde: "09:00:00", confirmacion_automatica: false, textos: { vacuna: "Hola {{nombre}}", x: 3 } });
  assert.equal(fila.recordatorio_desde, "09:00");
  assert.equal(fila.confirmacion_automatica, false);
  assert.deepEqual(fila.textos, { vacuna: "Hola {{nombre}}" });
  assert.equal(resumenRecordatorio(fila), "Sale 2 días antes, desde las 09:00");
  assert.equal(configuracionDesdeFila({ recordatorio_dias_antes: 9 }).recordatorio_dias_antes, 1);
});

test("la base entiende la respuesta con cautela", () => {
  const sql = leer("_clasificar_respuesta_ajuste.sql");
  // Preguntas y mensajes largos los lee una persona.
  assert.match(sql, /position\('\?' in v_original\) > 0/);
  assert.match(sql, /length\(v_original\) > 80/);
  // «No hay problema» confirma: se evalúa antes que el «no».
  assert.ok(sql.indexOf("no hay problema") < sql.indexOf("'^(no|nop|nope)( |$)'"));
  // Pedir otra hora se evalúa antes que el sí y el no: no mueve la cita.
  assert.ok(sql.indexOf("'reagendar'") < sql.indexOf("return 'no'"));
});

test("la confirmación solo toca la cita del recordatorio y nunca pierde el mensaje entrante", () => {
  const sql = leer("_confirmacion_por_respuesta.sql");
  assert.match(sql, /mensaje\.regla = 'cita_manana'/);
  assert.match(sql, /interval '72 hours'/);
  assert.match(sql, /cita\.inicio > now\(\)/);
  assert.match(sql, /not cfg\.confirmacion_automatica/);
  // Los disparadores atrapan cualquier error: el WhatsApp o el correo entran igual.
  assert.equal((sql.match(/exception when others then/g) ?? []).length, 2);
  // El recordatorio respeta la hora elegida y nunca sale de noche.
  assert.match(sql, /coalesce\(cfg\.recordatorio_desde, '10:00'::time\)/);
  assert.match(sql, /v_ahora::time < '21:00'::time/);
});
