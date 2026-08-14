export type RecordingIntegrity = "complete" | "incomplete" | "unknown" | "recording";

export function qualityTypificationLabel(row: {
  typification: string | null;
  callEndedAt: string | null;
  callDiscardedReason: string | null;
}): string {
  if (row.typification) return row.typification;
  if (row.callDiscardedReason) return "Descartada por error técnico";
  return row.callEndedAt ? "Sin tipificación registrada" : "Pendiente de tipificar";
}

export function classifyRecordingIntegrity(row: {
  endedAt: string | null;
  durationSeconds: number | null;
  queueTalkSeconds: number | null;
}): RecordingIntegrity {
  if (!row.endedAt) return "recording";
  if (row.durationSeconds === null || row.queueTalkSeconds === null) return "unknown";
  return row.durationSeconds + 2 >= row.queueTalkSeconds ? "complete" : "incomplete";
}
