import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  agreementRate,
  isSampleableReason,
  parsePautaRows,
  scorePauta,
  selectRubric,
  type PautaRubric,
} from "../src/lib/quality-pauta.ts";
import { agentScorecard, calibration, criterionGaps, summarize, type QualityCall } from "../src/lib/quality-scorecard.ts";

const general: PautaRubric = {
  key: "general",
  name: "Rúbrica general",
  outcomes: ["*"],
  criteria: [
    { id: "a", name: "Presentación", weight: 8, definition: "" },
    { id: "b", name: "Objeciones", weight: 20, definition: "" },
    { id: "c", name: "Silencios", weight: 72, definition: "" },
  ],
};
const noInteresa: PautaRubric = { ...general, key: "no_interesa", outcomes: ["not_interested"] };

test("elige la rúbrica por tipificación y usa la comodín para el resto", () => {
  const pauta = { rubrics: [general, noInteresa] };
  assert.equal(selectRubric(pauta, "not_interested")?.key, "no_interesa");
  assert.equal(selectRubric(pauta, "interested")?.key, "general");
  assert.equal(selectRubric(pauta, null)?.key, "general");
});

test("nota ponderada con la escala de la planilla: obs. 0,5 y no aplica 1", () => {
  const result = scorePauta(general, [
    { id: "a", status: "cumple" },
    { id: "b", status: "no_aplica" },
    { id: "c", status: "parcial" },
  ]);
  // 8 + 20 + 72 × 0,5 = 64
  assert.equal(result.score, 64);
  assert.equal(result.verdict, "parcial");
  assert.equal(result.criticalErrors, 0);
  assert.equal(result.nonCriticalErrors, 1);
});

test("un «No cumple» es error crítico y deja la llamada en No cumple", () => {
  const result = scorePauta(general, [
    { id: "a", status: "no_cumple" },
    { id: "b", status: "cumple" },
    { id: "c", status: "cumple" },
  ]);
  assert.equal(result.score, 92);
  assert.equal(result.verdict, "no_cumple");
  assert.equal(result.criticalErrors, 1);
});

test("lo no observable sale del denominador y bajo la mitad del peso no se evalúa", () => {
  const partial = scorePauta(general, [
    { id: "a", status: "cumple" },
    { id: "b", status: "cumple" },
    { id: "c", status: "no_observable" },
  ]);
  assert.equal(partial.score, 100);
  assert.equal(partial.verdict, "no_evaluable");
  const invalid = scorePauta(general, [{ id: "a", status: "cumple" }, { id: "b", status: "cumple" }, { id: "c", status: "cumple" }], undefined, "corte");
  assert.equal(invalid.verdict, "no_evaluable");
});

test("coincidencia IA ↔ analista por atributo", () => {
  assert.equal(
    agreementRate(
      [{ id: "a", status: "cumple" }, { id: "b", status: "parcial" }],
      [{ id: "a", status: "cumple" }, { id: "b", status: "cumple" }],
    ),
    0.5,
  );
});

test("lee la planilla de rúbrica del cliente con dos bloques y la tabla de medición", () => {
  const rows = [
    ["RUBRICA- GENERAL", null, null, null],
    ["Atributo", "Peso", "Definición", "Medición"],
    ["Presentación e identificación", 0.08, "Se presenta", "CUMPLE"],
    ["Manejo de objeciones", 0.92, "Responde", "CUMPLE"],
    ["RUBRICA- NO INTERESA", null, null, null],
    ["Atributo", "Peso", "Definición", null],
    ["Intento de generación de interés", 1, "No abandona", null],
    ["MEDICIÓN", "PONDERACIÓN", null, null],
    ["CUMPLE", 1, null, null],
    ["CUMPLE CON OBS", 0.5, null, null],
    ["NO CUMPLE", 0, null, null],
    ["NO APLICA", 1, null, null],
  ];
  const parsed = parsePautaRows(rows);
  assert.equal(parsed.rubrics.length, 2);
  assert.deepEqual(parsed.rubrics[0].outcomes, ["*"]);
  assert.deepEqual(parsed.rubrics[1].outcomes, ["not_interested"]);
  assert.equal(parsed.rubrics[0].criteria[0].weight, 8);
  assert.equal(parsed.rubrics[0].criteria[1].id, "manejo_de_objeciones");
  assert.equal(parsed.scale.parcial, 0.5);
  assert.deepEqual(parsed.warnings, []);
});

test("la planilla real de Equifax, si está disponible, entrega dos rúbricas que suman 100", (context) => {
  let buffer: Buffer;
  try {
    buffer = readFileSync(`${process.env.HOME}/Downloads/Rubrica Pauta Calidad.xlsx`);
  } catch {
    context.skip("La planilla no está en Descargas.");
    return;
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null });
  const parsed = parsePautaRows(rows);
  assert.equal(parsed.rubrics.length, 2);
  for (const rubric of parsed.rubrics) {
    assert.equal(Math.round(rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)), 100);
  }
});

function call(agentId: string, score: number, overrides: Partial<QualityCall> = {}): QualityCall {
  return {
    recordingId: `${agentId}-${score}-${Math.random()}`,
    agentId,
    campaignId: "c",
    startedAt: "2026-10-06T15:00:00Z",
    rubricKey: "equifax.general",
    rubricName: "Rúbrica general",
    source: "ia",
    score,
    verdict: "cumple",
    criticalErrors: 0,
    nonCriticalErrors: 0,
    criteria: [],
    aiCriteria: null,
    aiScore: score,
    aiAgreement: null,
    action: null,
    ...overrides,
  };
}

test("cuartiles, límites de control y objetivo por ejecutivo", () => {
  const calls = [
    call("ana", 100),
    call("ana", 98),
    call("beto", 96),
    call("carla", 90, { verdict: "parcial", nonCriticalErrors: 1 }),
    call("dani", 70, { verdict: "no_cumple", criticalErrors: 2 }),
    call("dani", 0, { verdict: "no_evaluable" }),
  ];
  const card = agentScorecard(calls, 95);
  assert.deepEqual(card.rows.map((row) => [row.agentId, row.quartile]), [["ana", 1], ["beto", 2], ["carla", 3], ["dani", 4]]);
  const dani = card.rows.find((row) => row.agentId === "dani")!;
  assert.equal(dani.evaluated, 2);
  assert.equal(dani.averageScore, 70);
  assert.equal(dani.pec, 0);
  assert.equal(dani.control, "bajo");
  assert.equal(card.rows[0].meetsObjective, true);

  const summary = summarize(calls, 95);
  assert.equal(summary.scored, 5);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.pec, 80);
  assert.equal(summary.penc, 80);
});

test("brechas ordenadas por puntos perdidos y calibración IA ↔ analista", () => {
  const calls = [
    call("ana", 80, {
      source: "validada",
      criteria: [
        { id: "a", name: "Presentación", weight: 8, status: "cumple" },
        { id: "b", name: "Objeciones", weight: 20, status: "no_cumple" },
      ],
      aiCriteria: [
        { id: "a", name: "Presentación", weight: 8, status: "parcial" },
        { id: "b", name: "Objeciones", weight: 20, status: "no_cumple" },
      ],
    }),
  ];
  const gaps = criterionGaps(calls);
  assert.equal(gaps[0].id, "b");
  assert.equal(gaps[0].pointsLost, 20);
  const calib = calibration(calls);
  assert.equal(calib.overall, 50);
  assert.equal(calib.rows.find((row) => row.id === "a")?.aiStricter, 1);
});

test("la muestra automática deja fuera las tipificaciones que no son conversación", () => {
  assert.equal(isSampleableReason("NUMERO ERRONEO / NO CORRESPONDE"), false);
  assert.equal(isSampleableReason("TERCERO NO ENTREGA INFORMACION"), false);
  assert.equal(isSampleableReason("CLIENTE CORTA LLAMADA"), false);
  assert.equal(isSampleableReason("NO ENTREGA CREDITO / PAGO CONTADO"), true);
  assert.equal(isSampleableReason("VOLVER A LLAMAR"), true);
  assert.equal(isSampleableReason(null), true);
});
