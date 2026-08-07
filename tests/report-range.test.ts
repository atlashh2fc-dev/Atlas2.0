import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REPORT_RANGE_DAYS,
  resolveReportRange,
  reportRangeSearchParams,
  toDateInput,
} from "../src/lib/report-range.ts";

// Viernes 7 de agosto de 2026, hora local.
const NOW = new Date(2026, 7, 7, 15, 30, 0);

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

test("el fin de día es inclusivo", () => {
  const range = resolveReportRange({ preset: "hoy" }, NOW);
  assert.equal(range.to.getHours(), 23);
  assert.equal(range.to.getMinutes(), 59);
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
