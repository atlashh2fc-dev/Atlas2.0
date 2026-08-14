export const QUALITY_TRANSCRIPTION_MIN_SECONDS = 120;
export const QUALITY_TRANSCRIPTION_OUTCOMES = ["sale", "not_interested"] as const;

export type QualityTranscriptionOutcome = (typeof QUALITY_TRANSCRIPTION_OUTCOMES)[number];
export type QualityTranscriptionEligibilityCode =
  | "eligible"
  | "not_ready"
  | "too_short"
  | "outcome_not_selected"
  | "incomplete_audio";

export type QualityTranscriptionEligibility = {
  eligible: boolean;
  code: QualityTranscriptionEligibilityCode;
  label: string;
};

export function evaluateQualityTranscriptionEligibility(input: {
  recordingStatus: string;
  durationSeconds: number | null;
  queueTalkSeconds: number | null;
  outcome: string | null;
}): QualityTranscriptionEligibility {
  if (input.recordingStatus !== "ready") {
    return { eligible: false, code: "not_ready", label: "Audio no disponible" };
  }
  if (
    input.queueTalkSeconds !== null &&
    input.durationSeconds !== null &&
    input.durationSeconds < input.queueTalkSeconds - 2
  ) {
    return { eligible: false, code: "incomplete_audio", label: "Audio incompleto" };
  }
  if (input.durationSeconds === null || input.durationSeconds <= QUALITY_TRANSCRIPTION_MIN_SECONDS) {
    return { eligible: false, code: "too_short", label: "Duración menor o igual a 2 min" };
  }
  if (!QUALITY_TRANSCRIPTION_OUTCOMES.includes(input.outcome as QualityTranscriptionOutcome)) {
    return { eligible: false, code: "outcome_not_selected", label: "Tipificación no seleccionada" };
  }
  return { eligible: true, code: "eligible", label: "Seleccionada para calidad" };
}
