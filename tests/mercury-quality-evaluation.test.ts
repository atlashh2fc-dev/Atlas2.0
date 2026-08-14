import assert from "node:assert/strict";
import test from "node:test";

import { __test__ } from "../src/lib/mercury-quality-evaluation.ts";
import {
  isSecretariaVirtualAuditCampaign,
  SECRETARIA_VIRTUAL_RUBRIC_CRITERIA,
} from "../src/lib/secretaria-virtual-quality-rubric.ts";

test("aplica la pauta solo a Secretaría Virtual outbound", () => {
  assert.equal(isSecretariaVirtualAuditCampaign("Secretaría Virtual"), true);
  assert.equal(isSecretariaVirtualAuditCampaign(" Secretaria Virtual "), true);
  assert.equal(isSecretariaVirtualAuditCampaign("Secretaria Virtual - Inbound"), false);
});

function rawEvaluation(speakerConfidence = 0.9) {
  return {
    speaker_confidence: speakerConfidence,
    summary: "La llamada cubre la pauta observable.",
    criteria: SECRETARIA_VIRTUAL_RUBRIC_CRITERIA.map((criterion) => ({
      id: criterion.id,
      status: criterion.conditional ? "no_aplica" : "cumple",
      score: criterion.conditional ? 0 : criterion.maxScore,
      finding: criterion.conditional ? "No hubo objeciones." : "Cumple con evidencia.",
      evidence: criterion.conditional
        ? []
        : [{ quote: "frase observable", start_seconds: 1, end_seconds: 2 }],
    })),
    strengths: ["Buena cobertura"],
    improvements: [],
    objections: [],
    risk_flags: [],
  };
}

test("normaliza el puntaje sin castigar criterios condicionales que no aplican", () => {
  const result = __test__.normalizeEvaluation(rawEvaluation());
  assert.equal(result.overallScore, 100);
  assert.equal(result.verdict, "cumple");
  assert.equal(result.criteria.length, SECRETARIA_VIRTUAL_RUBRIC_CRITERIA.length);
  assert.equal(result.criteria.find((criterion) => criterion.id === "manejo_objeciones")?.status, "no_aplica");
});

test("una atribución de hablantes débil obliga revisión y queda no evaluable", () => {
  const result = __test__.normalizeEvaluation(rawEvaluation(0.4));
  assert.equal(result.overallScore, 100);
  assert.equal(result.verdict, "no_evaluable");
});

test("preserva timestamps como evidencia sin inventar hablantes", () => {
  assert.equal(
    __test__.transcriptEvidence("texto plano", [
      { start: 0, end: 2, text: "Buenas tardes" },
      { start: 62, end: 64, text: "Le envío la información" },
    ]),
    "[0:00] Buenas tardes\n[1:02] Le envío la información"
  );
});
