import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REPORT_RANGE_DAYS,
  parseDateTimeInput,
  REPORT_TIME_ZONE,
  resolveReportRange,
  reportRangeSearchParams,
  toDateInput,
  toDateTimeInput,
} from "../src/lib/report-range.ts";

// Viernes 7 de agosto de 2026, 11:30 en Chile (15:30 UTC, invierno: UTC-4).
// Se fija el instante en UTC a propósito: el proceso corre en UTC en Vercel y
// el resultado tiene que ser el mismo sin importar la zona de la máquina.
const NOW = new Date("2026-08-07T15:30:00Z");

// Instante en que en UTC ya es el día siguiente pero en Chile todavía no:
// 22:00 del 7 de agosto en Chile son las 02:00 del 8 en UTC.
const NOCHE_CHILENA = new Date("2026-08-08T02:00:00Z");

test("sin parámetros usa los últimos 30 días", () => {
  const range = resolveReportRange({}, NOW);
  assert.equal(range.preset, "30d");
  assert.equal(toDateInput(range.from), "2026-07-09");
  assert.equal(toDateInput(range.to), "2026-08-07");
  assert.equal(range.days, 30);
});

test("el comparativo tiene la misma duración y termina justo antes", () => {
  const range = resolveReportRange({ preset: "7d" }, NOW);
  assert.equal(toDateInput(range.from), "2026-08-01");
  assert.equal(range.days, 7);
  // Antes se restaban 30 días fijos, así que un rango de 7 comparaba contra
  // una ventana que no le correspondía.
  assert.equal(toDateInput(range.previousFrom), "2026-07-25");
  assert.equal(toDateInput(range.previousTo), "2026-07-31");
  assert.equal(range.previousTo.getTime(), range.from.getTime() - 1);
});

test("la semana empieza el lunes", () => {
  const range = resolveReportRange({ preset: "semana" }, NOW);
  assert.equal(toDateInput(range.from), "2026-08-03");
  assert.equal(toDateInput(range.to), "2026-08-07");
});

test("la semana pasada es un bloque cerrado de lunes a domingo", () => {
  const range = resolveReportRange({ preset: "semana_pasada" }, NOW);
  assert.equal(toDateInput(range.from), "2026-07-27");
  assert.equal(toDateInput(range.to), "2026-08-02");
  assert.equal(range.days, 7);
});

test("el mes pasado cubre el mes calendario completo", () => {
  const range = resolveReportRange({ preset: "mes_pasado" }, NOW);
  assert.equal(toDateInput(range.from), "2026-07-01");
  assert.equal(toDateInput(range.to), "2026-07-31");
  assert.equal(range.days, 31);
});

test("un rango personalizado se respeta tal cual", () => {
  const range = resolveReportRange({ from: "2026-06-01", to: "2026-06-15" }, NOW);
  assert.equal(range.preset, "custom");
  assert.equal(toDateInput(range.from), "2026-06-01");
  assert.equal(toDateInput(range.to), "2026-06-15");
  assert.equal(range.days, 15);
  assert.equal(range.notice, null);
});

test("las fechas invertidas se corrigen con aviso", () => {
  const range = resolveReportRange({ from: "2026-06-15", to: "2026-06-01" }, NOW);
  assert.equal(toDateInput(range.from), "2026-06-01");
  assert.equal(toDateInput(range.to), "2026-06-15");
  assert.match(range.notice ?? "", /invertidas/);
});

test("un rango descomunal se recorta al tope", () => {
  const range = resolveReportRange({ from: "2019-01-01", to: "2026-08-07" }, NOW);
  assert.equal(range.days, MAX_REPORT_RANGE_DAYS);
  assert.equal(toDateInput(range.to), "2026-08-07");
  assert.match(range.notice ?? "", /máximo/);
});

test("un preset inválido no rompe la pantalla", () => {
  const range = resolveReportRange({ preset: "'; drop table leads;--" }, NOW);
  assert.equal(range.preset, "30d");
});

test("custom sin fechas cae al período por defecto avisando", () => {
  const range = resolveReportRange({ preset: "custom" }, NOW);
  assert.equal(range.preset, "30d");
  assert.match(range.notice ?? "", /incompleto/);
});

test("el período se calcula en la zona de la operación, no en la del proceso", () => {
  // Con el proceso en UTC, "Hoy" arrancaba a las 00:00 UTC — las 20:00 del día
  // anterior en Chile— y el reporte mostraba media jornada de ayer.
  const range = resolveReportRange({ preset: "hoy" }, NOW);
  assert.equal(toDateInput(range.from), "2026-08-07");
  assert.equal(toDateInput(range.to), "2026-08-07");
  assert.equal(range.days, 1);
  // 00:00 en Chile (UTC-4) son las 04:00 UTC del mismo día.
  assert.equal(range.from.toISOString(), "2026-08-07T04:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-08-08T03:59:59.999Z");
});

test("de noche en Chile el día sigue siendo el de acá, aunque en UTC ya cambió", () => {
  const range = resolveReportRange({ preset: "hoy" }, NOCHE_CHILENA);
  assert.equal(toDateInput(range.from), "2026-08-07");
  assert.equal(toDateInput(range.to), "2026-08-07");
});

test("datetime-local usa la hora de Chile aunque el proceso esté en UTC", () => {
  assert.equal(toDateTimeInput(new Date("2026-08-10T16:00:00Z")), "2026-08-10T12:00");
  assert.equal(parseDateTimeInput("2026-08-10T12:00")?.toISOString(), "2026-08-10T16:00:00.000Z");
});

test("el comparativo de 'Hoy' es el día anterior completo", () => {
  const range = resolveReportRange({ preset: "hoy" }, NOW);
  assert.equal(toDateInput(range.previousFrom), "2026-08-06");
  assert.equal(toDateInput(range.previousTo), "2026-08-06");
});

test("cruzar el cambio de horario no desplaza el rango", () => {
  // Chile adelanta la hora el primer domingo de septiembre de 2026.
  const range = resolveReportRange({ from: "2026-08-31", to: "2026-09-10" });
  assert.equal(toDateInput(range.from), "2026-08-31");
  assert.equal(toDateInput(range.to), "2026-09-10");
  assert.equal(range.days, 11);
});

test("el fin de día es inclusivo", () => {
  const range = resolveReportRange({ preset: "hoy" }, NOW);
  // Se comprueba la hora de pared en Chile: `getHours()` daría la del proceso.
  const horaChilena = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(range.to);
  assert.equal(horaChilena, "23:59");
  assert.equal(toDateInput(range.from), toDateInput(range.to));
});

test("cambiar de período conserva el resto de la query", () => {
  const range = resolveReportRange({ preset: "7d" }, NOW);
  const params = reportRangeSearchParams(range, new URLSearchParams("campaign=abc&from=2026-01-01&to=2026-01-31"));
  assert.equal(params.get("campaign"), "abc");
  assert.equal(params.get("preset"), "7d");
  // Un preset no debe arrastrar las fechas del rango personalizado anterior.
  assert.equal(params.get("from"), null);
  assert.equal(params.get("to"), null);
});

test("el rango personalizado sí viaja en la query", () => {
  const range = resolveReportRange({ from: "2026-06-01", to: "2026-06-15" }, NOW);
  const params = reportRangeSearchParams(range, new URLSearchParams("campaign=abc"));
  assert.equal(params.get("preset"), "custom");
  assert.equal(params.get("from"), "2026-06-01");
  assert.equal(params.get("to"), "2026-06-15");
});
