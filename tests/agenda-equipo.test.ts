// Agenda semanal, equipo y sillones.
//
// Si esto se rompe, la grilla corta citas que caen fuera de las 8 a 20, el
// resumen del horario miente, o dos citas ocupan el mismo sillón.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { HORARIO_POR_DEFECTO, rangoDeLaGrilla, resumenHorario, tramosPorDia } from "../src/lib/configuracion-agenda.ts";

const migraciones = readdirSync(new URL("../supabase/migrations", import.meta.url));
const sql = readFileSync(new URL(`../supabase/migrations/${migraciones.find((nombre) => nombre.endsWith("_sillones_y_agenda_por_recurso.sql"))}`, import.meta.url), "utf8");

test("el resumen junta los días seguidos con el mismo horario", () => {
  assert.equal(resumenHorario(tramosPorDia(HORARIO_POR_DEFECTO)), "lun a vie 09:00–19:00 · sáb 10:00–14:00");
  const conColacion = tramosPorDia([
    { dia_semana: 1, desde: "09:00", hasta: "13:30" },
    { dia_semana: 1, desde: "14:30", hasta: "19:00" },
    { dia_semana: 3, desde: "09:00", hasta: "13:30" },
  ]);
  assert.equal(resumenHorario(conColacion), "lun 09:00–13:30 y 14:30–19:00 · mié 09:00–13:30");
  assert.equal(resumenHorario(tramosPorDia([])), "sin días abiertos");
});

test("la grilla cubre desde la primera apertura hasta el último cierre", () => {
  assert.deepEqual(rangoDeLaGrilla([]), { apertura: 8, cierre: 20 });
  assert.deepEqual(rangoDeLaGrilla([{ desde: "07:30", hasta: "13:00" }, { desde: "15:00", hasta: "21:15" }]), { apertura: 7, cierre: 22 });
  assert.deepEqual(rangoDeLaGrilla(HORARIO_POR_DEFECTO), { apertura: 9, cierre: 19 });
});

test("agendar comprueba el sillón además del profesional", () => {
  assert.match(sql, /where cita\.recurso_id = p_recurso/);
  assert.match(sql, /ya está ocupado a las/);
  // El recurso es opcional: lo que ya llamaba a agendar_cita sin él sigue funcionando.
  assert.match(sql, /p_recurso uuid default null/);
  assert.match(sql, /grant execute on function public\.agendar_cita\(uuid, uuid, timestamptz, integer, text, uuid, text, uuid\) to authenticated;/);
});
