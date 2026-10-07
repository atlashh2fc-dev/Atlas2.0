import assert from "node:assert/strict";
import test from "node:test";

import {
  PROGRAMACION_POR_DEFECTO,
  describirProgramacion,
  etiquetaDeAccion,
  pendientesParaLanzar,
  porcentaje,
} from "../src/lib/campanas-correo.ts";

test("la programación se resume en una frase en hora de Chile", () => {
  assert.equal(
    describirProgramacion(PROGRAMACION_POR_DEFECTO, 50),
    "Envía de lunes a viernes, de 09:00 a 13:00 y de 15:00 a 18:00 (hora de Chile), apenas la lances. Hasta 50 correos nuevos por día, repartidos en esas horas.",
  );
  assert.equal(
    describirProgramacion({ ...PROGRAMACION_POR_DEFECTO, dias: [2, 4], ventanas: [{ inicio: "10:00", fin: "12:00" }], inicio_fecha: "2026-10-13", inicio_hora: "10:00", fin_fecha: "2026-10-31", fin_hora: "18:00" }, null),
    "Envía los martes y jueves, de 10:00 a 12:00 (hora de Chile), desde el 13 de octubre a las 10:00 y hasta el 31 de octubre.",
  );
  assert.match(describirProgramacion({ ...PROGRAMACION_POR_DEFECTO, dias: [0, 1, 2, 3, 4, 5, 6] }, null), /^Envía todos los días/);
});

test("dice qué falta para lanzar, en orden", () => {
  const vacia = { contenido: { pasos: [], cabecera: { imagen_url: null, titulo: null, bajada: null, precio: null }, editable: true }, audiencia: { lote_id: null, total: 0, nombre: null, ola: null }, programacion: null };
  assert.deepEqual(pendientesParaLanzar(vacia), ["Escribir al menos un correo", "Cargar la audiencia", "Definir cuándo envía"]);
  const lista = {
    ...vacia,
    contenido: { ...vacia.contenido, pasos: [{ asunto: "Hola", cuerpo: "Un correo de prueba", imagen_url: null, espera_dias_habiles: 0, condicion: "todos" as const }] },
    audiencia: { ...vacia.audiencia, total: 120 },
    programacion: PROGRAMACION_POR_DEFECTO,
  };
  assert.deepEqual(pendientesParaLanzar(lista), []);
});

test("porcentajes y acciones se muestran en palabras", () => {
  assert.equal(porcentaje(1, 3), "33,3 %");
  assert.equal(porcentaje(5, 0), "—");
  assert.equal(etiquetaDeAccion("ajuste_agente"), "Órbita ajustó la campaña");
  assert.equal(etiquetaDeAccion("otra"), "otra");
});
