import assert from "node:assert/strict";
import test from "node:test";

import {
  agrupar,
  antiguedadSaldos,
  calcularKpis,
  calorAgenda,
  diaSemana,
  filtrarAtenciones,
  filtrarPlanes,
  hallazgos,
  leerHechos,
  periodoAnterior,
  primerasVisitas,
  serie,
  tramos,
  variacion,
} from "../src/lib/reporte-clinica.ts";
import { resolveReportRange, toDateInput } from "../src/lib/report-range.ts";

// Filas con la misma forma que devuelve la RPC reporte_clinica.
const RAW = {
  atenciones: [
    ["a1", "2026-09-01", "c1", "Dra. Ríos", "Operatoria", "Resina", 50000, 8000, true, false, null, null],
    ["a2", "2026-09-01", "c1", "Dra. Ríos", "Prevención", "Limpieza", 30000, 2000, false, false, null, null],
    ["a3", "2026-09-10", "c2", "Dr. Soto", "Operatoria", "Resina", 50000, 8000, true, false, null, null],
    ["a4", "2026-09-15", "c1", "Dr. Soto", "Cirugía", "Extracción", 120000, 20000, true, true, null, null],
    // Período anterior (agosto 2 a 31, mismo largo que 1 a 30 de septiembre)
    ["a5", "2026-08-20", "c3", "Dra. Ríos", "Operatoria", "Resina", 40000, 8000, true, false, null, null],
  ],
  citas: [
    ["x1", "2026-09-01T09:00", 30, "c1", "Dra. Ríos", "atendida", "Control", null],
    ["x2", "2026-09-02T10:00", 30, "c2", "Dr. Soto", "no_vino", "Control", null],
    ["x3", "2026-09-03T10:00", 30, "c2", "Dr. Soto", "cancelada", "Control", null],
    ["x4", "2026-09-29T11:00", 30, "c3", "Dr. Soto", "reservada", "Control", null],
  ],
  planes: [
    ["p1", "2026-09-02", "c1", "Implante", "ganada", 900000, "2026-09-12", null, "Aceptado", 4, "instagram"],
    ["p2", "2026-09-05", "c2", "Corona", "perdida", 300000, "2026-09-20", "Precio", "Rechazado", 5, null],
    ["p3", "2026-09-06", "c3", "Ortodoncia", "abierta", 1500000, null, null, "Enviado", 2, "google"],
  ],
  pagos: [],
  saldos: [
    ["2026-09-01", "c1", 30000, "Dra. Ríos"],
    ["2026-05-01", "c2", 80000, "Dr. Soto"],
  ],
  cuentas: [
    ["c1", "Camila Rojas", "2026-08-30", "instagram", "Providencia", "2026-09-01"],
    ["c2", "Pedro Díaz", "2024-01-10", "google", "Ñuñoa", "2024-02-01"],
    ["c3", "Ana Soto", "2026-08-01", "referido", null, "2026-08-20"],
  ],
  vacunas: [],
};

const SEP: { desde: string; hasta: string } = { desde: "2026-09-01", hasta: "2026-09-30" };
const HOY = "2026-09-22";

test("el período anterior tiene el mismo largo y termina el día antes", () => {
  assert.deepEqual(periodoAnterior(SEP), { desde: "2026-08-02", hasta: "2026-08-31" });
  assert.deepEqual(periodoAnterior({ desde: "2026-09-22", hasta: "2026-09-22" }), { desde: "2026-09-21", hasta: "2026-09-21" });
});

test("los KPIs suman producción, visitas, margen y cobrado", () => {
  const h = leerHechos(RAW);
  const k = calcularKpis(h, SEP, {}, HOY);
  assert.equal(k.produccion, 250000);
  assert.equal(k.atenciones, 4);
  // c1 el 1 de septiembre es una sola visita aunque tenga dos atenciones.
  assert.equal(k.visitas, 3);
  assert.equal(k.pacientes, 2);
  assert.equal(k.costo, 38000);
  assert.equal(k.pendienteDelPeriodo, 30000);
  assert.equal(Math.round(k.cobradoPct!), 88);
  // Solo c1 tuvo su primera atención de la historia en septiembre.
  assert.equal(k.nuevos, 1);
  assert.equal(k.urgencias, 1);
});

test("la asistencia no cuenta las citas que todavía no llegan ni las canceladas", () => {
  const k = calcularKpis(leerHechos(RAW), SEP, {}, HOY);
  assert.equal(k.atendidas, 1);
  assert.equal(k.noVino, 1);
  assert.equal(k.asistenciaPct, 50);
  assert.equal(k.canceladas, 1);
});

test("la conversión de presupuestos es aceptados sobre creados", () => {
  const k = calcularKpis(leerHechos(RAW), SEP, {}, HOY);
  assert.equal(k.planesCreados, 3);
  assert.equal(k.planesGanados, 1);
  assert.equal(k.valorAceptado, 900000);
  assert.equal(Math.round(k.conversionPct!), 33);
});

test("los filtros cruzan conjuntos: el origen del presupuesto manda y si falta vale el de la ficha", () => {
  const h = leerHechos(RAW);
  assert.deepEqual(filtrarPlanes(h, SEP, { origen: "Google" }).map((p) => p.id).sort(), ["p2", "p3"]);
  assert.deepEqual(filtrarAtenciones(h, SEP, { profesional: "Dr. Soto", categoria: "Operatoria" }).map((a) => a.id), ["a3"]);
  assert.deepEqual(filtrarAtenciones(h, SEP, { comuna: "Ñuñoa" }).map((a) => a.id), ["a3"]);
  assert.deepEqual(filtrarAtenciones(h, SEP, { dia: "Mar" }).map((a) => a.id).sort(), ["a1", "a2", "a4"]);
});

test("agrupar ordena por valor y trae el período anterior aunque ya no exista el grupo", () => {
  const h = leerHechos(RAW);
  const grupos = agrupar(filtrarAtenciones(h, SEP, {}), filtrarAtenciones(h, periodoAnterior(SEP), {}), (a) => a.categoria, (a) => a.monto);
  assert.deepEqual(grupos.map((g) => g.clave), ["Cirugía", "Operatoria", "Prevención"]);
  assert.equal(grupos[1].anterior, 40000);
});

test("la serie no deja huecos y alinea el período anterior tramo a tramo", () => {
  const h = leerHechos(RAW);
  const puntos = serie(filtrarAtenciones(h, SEP, {}), filtrarAtenciones(h, periodoAnterior(SEP), {}), (a) => a.fecha, (a) => a.monto, SEP, "dia");
  assert.equal(puntos.length, 30);
  assert.equal(puntos[0].valor, 80000);
  // 20 de agosto es el día 19 del período anterior, igual que el 19 de septiembre.
  assert.equal(puntos[18].anterior, 40000);
  assert.deepEqual(tramos("2026-09-01", "2026-09-30", "semana")[0], "2026-08-31");
  assert.deepEqual(tramos("2025-11-15", "2026-02-02", "mes"), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
});

test("el mapa de calor pone cada cita en su día y hora de Chile", () => {
  const calor = calorAgenda(leerHechos(RAW).citas);
  assert.equal(diaSemana("2026-09-01"), 1);
  const nueve = calor.horas.indexOf(9);
  assert.equal(calor.celdas[1][nueve], 1);
  // La cancelada no ocupa agenda.
  assert.equal(calor.celdas[3][calor.horas.indexOf(10)], 0);
});

test("la antigüedad de lo por cobrar se cuenta desde la atención", () => {
  const tramosSaldo = antiguedadSaldos(leerHechos(RAW).saldos, HOY);
  assert.equal(tramosSaldo[0].monto, 30000);
  assert.equal(tramosSaldo[3].monto, 80000);
});

test("la variación sin base no inventa un porcentaje", () => {
  assert.equal(variacion(10, 0), null);
  assert.equal(variacion(0, 0), 0);
  assert.equal(variacion(150, 100), 50);
});

test("la lectura del período explica el cambio y ofrece bajar al detalle", () => {
  const lectura = hallazgos(leerHechos(RAW), SEP, {}, HOY);
  assert.match(lectura[0].texto, /subió/);
  assert.equal(lectura[1].filtro?.dimension, "categoria");
  assert.equal(lectura[1].filtro?.valor, "Cirugía");
  assert.equal(primerasVisitas(leerHechos(RAW), SEP, {}).length, 1);
});

test("los períodos largos de la clínica caben en el tope de un año", () => {
  const ahora = new Date("2026-09-22T15:00:00Z");
  const anio = resolveReportRange({ preset: "anio" }, ahora);
  assert.equal(toDateInput(anio.from), "2026-01-01");
  const pasado = resolveReportRange({ preset: "anio_pasado" }, ahora);
  assert.equal(toDateInput(pasado.from), "2025-01-01");
  assert.equal(toDateInput(pasado.to), "2025-12-31");
  const trimestre = resolveReportRange({ preset: "trimestre_pasado" }, ahora);
  assert.equal(toDateInput(trimestre.from), "2026-04-01");
  assert.equal(toDateInput(trimestre.to), "2026-06-30");
  const doce = resolveReportRange({ preset: "12m" }, ahora);
  assert.equal(doce.days, 365);
});

test("la comparación contra el año pasado usa el mismo tramo del calendario", async () => {
  const { mismoPeriodoAnioAnterior, inicioDeLosHechos } = await import("../src/lib/reporte-clinica.ts");
  assert.deepEqual(mismoPeriodoAnioAnterior({ desde: "2026-01-01", hasta: "2026-09-22" }), { desde: "2025-01-01", hasta: "2025-09-22" });
  assert.deepEqual(mismoPeriodoAnioAnterior({ desde: "2028-02-01", hasta: "2028-02-29" }), { desde: "2027-02-01", hasta: "2027-02-28" });
  // Se traen hechos desde lo más antiguo de las dos comparaciones.
  assert.equal(inicioDeLosHechos({ desde: "2026-09-01", hasta: "2026-09-30" }), "2025-09-01");
  assert.equal(inicioDeLosHechos({ desde: "2025-01-01", hasta: "2025-12-31" }), "2024-01-01");
});
