import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGroqTranscription } from "../src/lib/groq-transcription.ts";
import { evaluateQualityTranscriptionEligibility } from "../src/lib/quality-transcription-policy.ts";

test("selecciona ventas y rechazos de más de dos minutos", () => {
  for (const outcome of ["sale", "not_interested"]) {
    assert.deepEqual(
      evaluateQualityTranscriptionEligibility({
        recordingStatus: "ready",
        durationSeconds: 121,
        queueTalkSeconds: 121,
        outcome,
      }),
      { eligible: true, code: "eligible", label: "Seleccionada para calidad" }
    );
  }
});

test("dos minutos exactos no consumen transcripción", () => {
  assert.equal(
    evaluateQualityTranscriptionEligibility({
      recordingStatus: "ready",
      durationSeconds: 120,
      queueTalkSeconds: 120,
      outcome: "sale",
    }).code,
    "too_short"
  );
});

test("excluye otras tipificaciones y audios incompletos", () => {
  assert.equal(
    evaluateQualityTranscriptionEligibility({
      recordingStatus: "ready",
      durationSeconds: 180,
      queueTalkSeconds: 180,
      outcome: "callback",
    }).code,
    "outcome_not_selected"
  );
  assert.equal(
    evaluateQualityTranscriptionEligibility({
      recordingStatus: "ready",
      durationSeconds: 177.9,
      queueTalkSeconds: 180,
      outcome: "not_interested",
    }).code,
    "incomplete_audio"
  );
});

test("normaliza la respuesta estructurada de Groq sin inventar hablantes", () => {
  assert.deepEqual(
    normalizeGroqTranscription({
      text: "Buenas tardes.",
      language: "Spanish",
      duration: 2.5,
      segments: [{ id: 0, start: 0, end: 2.5, text: "Buenas tardes." }],
      words: [{ word: "Buenas", start: 0, end: 1 }],
      x_groq: { id: "request-1" },
    }),
    {
      text: "Buenas tardes.",
      language: "Spanish",
      durationSeconds: 2.5,
      segments: [{ id: 0, start: 0, end: 2.5, text: "Buenas tardes." }],
      words: [{ word: "Buenas", start: 0, end: 1 }],
      requestId: "request-1",
    }
  );
});
