import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { evaluateWithMercury, MERCURY_QUALITY_MODEL } from "@/lib/mercury-quality-evaluation";
import {
  isSecretariaVirtualAuditCampaign,
  SECRETARIA_VIRTUAL_RUBRIC,
  SECRETARIA_VIRTUAL_RUBRIC_KEY,
  SECRETARIA_VIRTUAL_RUBRIC_NAME,
  SECRETARIA_VIRTUAL_RUBRIC_VERSION,
} from "@/lib/secretaria-virtual-quality-rubric";
import { evaluateQualityTranscriptionEligibility } from "@/lib/quality-transcription-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESSING_STALE_MS = 10 * 60 * 1000;

type RecordingRow = {
  id: string;
  call_id: string;
  campaign_id: string;
  duration_seconds: number | string | null;
  queue_talk_seconds: number | string | null;
  status: string;
};
type TranscriptionRow = {
  id: string;
  source_sha256: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript_text: string | null;
  segments: { start?: number; end?: number; text?: string }[];
};
type EvaluationRow = {
  id: string;
  recording_id: string;
  transcription_id: string;
  transcription_source_sha256: string;
  rubric_key: string;
  rubric_version: number;
  rubric_name: string;
  status: "pending" | "processing" | "completed" | "failed";
  overall_score: number | string | null;
  verdict: "cumple" | "parcial" | "no_cumple" | "no_evaluable" | null;
  speaker_confidence: number | string | null;
  summary: string | null;
  criteria: unknown[];
  strengths: unknown[];
  improvements: unknown[];
  objections: unknown[];
  risk_flags: unknown[];
  attempt_count: number;
  processing_started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

const EVALUATION_SELECT =
  "id, recording_id, transcription_id, transcription_source_sha256, rubric_key, rubric_version, rubric_name, status, overall_score, verdict, speaker_confidence, summary, criteria, strengths, improvements, objections, risk_flags, attempt_count, processing_started_at, completed_at, error_message";

function json(payload: object, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function authorizeRecording(id: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: json({ error: "Debes iniciar sesión." }, 401) } as const;
  if (!profile.active || (profile.role !== "admin" && profile.role !== "supervisor")) {
    return { error: json({ error: "No tienes permiso para auditar grabaciones." }, 403) } as const;
  }
  if (!UUID_PATTERN.test(id)) return { error: json({ error: "Grabación inválida." }, 400) } as const;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_recordings")
    .select("id, call_id, campaign_id, duration_seconds, queue_talk_seconds, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: json({ error: "No se pudo consultar la grabación." }, 500) } as const;
  if (!data) {
    return { error: json({ error: "La grabación no existe o no está dentro de tu alcance." }, 404) } as const;
  }
  return { profile, supabase, recording: data as RecordingRow } as const;
}

function publicEvaluation(row: EvaluationRow) {
  return {
    id: row.id,
    status: row.status,
    score: row.overall_score === null ? null : Number(row.overall_score),
    verdict: row.verdict,
    speakerConfidence:
      row.speaker_confidence === null ? null : Number(row.speaker_confidence),
    summary: row.summary,
    criteria: Array.isArray(row.criteria) ? row.criteria : [],
    strengths: Array.isArray(row.strengths) ? row.strengths : [],
    improvements: Array.isArray(row.improvements) ? row.improvements : [],
    objections: Array.isArray(row.objections) ? row.objections : [],
    riskFlags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
    rubric: {
      key: row.rubric_key,
      version: row.rubric_version,
      name: row.rubric_name,
    },
    completedAt: row.completed_at,
    error: row.status === "failed" ? "La auditoría falló. Puedes reintentar." : null,
  };
}

async function campaignName(campaignId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .select("name")
    .eq("id", campaignId)
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo validar la campaña.");
  return data.name as string;
}

async function callOutcome(callId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calls")
    .select("outcome")
    .eq("id", callId)
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo validar la tipificación de la llamada.");
  return data.outcome as string | null;
}

function auditEligibility(recording: RecordingRow, outcome: string | null) {
  return evaluateQualityTranscriptionEligibility({
    recordingStatus: recording.status,
    durationSeconds:
      recording.duration_seconds === null ? null : Number(recording.duration_seconds),
    queueTalkSeconds:
      recording.queue_talk_seconds === null ? null : Number(recording.queue_talk_seconds),
    outcome,
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await authorizeRecording(id);
  if ("error" in authorized) return authorized.error;

  const name = await campaignName(authorized.recording.campaign_id).catch(() => null);
  if (!name) return json({ error: "No se pudo validar la campaña." }, 500);
  if (!isSecretariaVirtualAuditCampaign(name)) {
    return json({ status: "not_applicable", message: "Esta campaña no usa la pauta de Secretaría Virtual." });
  }

  const { data, error } = await authorized.supabase
    .from("call_quality_evaluations")
    .select(EVALUATION_SELECT)
    .eq("recording_id", id)
    .eq("rubric_key", SECRETARIA_VIRTUAL_RUBRIC_KEY)
    .eq("rubric_version", SECRETARIA_VIRTUAL_RUBRIC_VERSION)
    .maybeSingle();
  if (error) return json({ error: "No se pudo consultar la auditoría." }, 500);
  if (!data) return json({ status: "pending", rubric: SECRETARIA_VIRTUAL_RUBRIC });
  return json(publicEvaluation(data as EvaluationRow));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await authorizeRecording(id);
  if ("error" in authorized) return authorized.error;

  const name = await campaignName(authorized.recording.campaign_id).catch(() => null);
  if (!name) return json({ error: "No se pudo validar la campaña." }, 500);
  if (!isSecretariaVirtualAuditCampaign(name)) {
    return json({ error: "Esta campaña no usa la pauta de Secretaría Virtual." }, 422);
  }

  const outcome = await callOutcome(authorized.recording.call_id).catch(() => undefined);
  if (outcome === undefined) {
    return json({ error: "No se pudo validar la tipificación de la llamada." }, 500);
  }
  const eligibility = auditEligibility(authorized.recording, outcome);
  const body = await request.json().catch(() => ({})) as { overrideSelection?: unknown };
  const overrideSelection = body.overrideSelection === true;
  if (!eligibility.eligible && !overrideSelection) {
    return json(
      {
        error: `Esta llamada no fue seleccionada automáticamente: ${eligibility.label}. Puedes evaluarla manualmente.`,
        code: "manual_override_required",
        eligibility,
      },
      422
    );
  }

  const apiKey = process.env.INCEPTION_API_KEY?.trim();
  if (!apiKey) {
    return json({ error: "Falta configurar INCEPTION_API_KEY en el entorno de producción." }, 503);
  }

  const admin = createAdminClient();
  const { data: transcriptionData, error: transcriptionError } = await admin
    .from("call_transcriptions")
    .select("id, source_sha256, status, transcript_text, segments")
    .eq("recording_id", id)
    .maybeSingle();
  if (transcriptionError) return json({ error: "No se pudo consultar la transcripción." }, 500);
  const transcription = transcriptionData as TranscriptionRow | null;
  if (transcription?.status !== "completed" || !transcription.transcript_text?.trim()) {
    return json({ error: "La llamada debe estar transcrita antes de auditarla." }, 409);
  }

  const { data: existingData, error: existingError } = await admin
    .from("call_quality_evaluations")
    .select(EVALUATION_SELECT)
    .eq("recording_id", id)
    .eq("rubric_key", SECRETARIA_VIRTUAL_RUBRIC_KEY)
    .eq("rubric_version", SECRETARIA_VIRTUAL_RUBRIC_VERSION)
    .maybeSingle();
  if (existingError) return json({ error: "No se pudo preparar la auditoría." }, 500);
  const existing = existingData as EvaluationRow | null;

  if (
    existing?.status === "completed" &&
    existing.transcription_source_sha256 === transcription.source_sha256
  ) {
    return json(publicEvaluation(existing));
  }
  if (
    existing?.status === "processing" &&
    existing.processing_started_at &&
    Date.now() - new Date(existing.processing_started_at).getTime() < PROCESSING_STALE_MS
  ) {
    return json({ status: "processing", message: "La llamada ya se está auditando." }, 409);
  }

  const startedAt = new Date().toISOString();
  const processingPayload = {
    recording_id: id,
    transcription_id: transcription.id,
    transcription_source_sha256: transcription.source_sha256,
    rubric_key: SECRETARIA_VIRTUAL_RUBRIC_KEY,
    rubric_version: SECRETARIA_VIRTUAL_RUBRIC_VERSION,
    rubric_name: SECRETARIA_VIRTUAL_RUBRIC_NAME,
    rubric_snapshot: SECRETARIA_VIRTUAL_RUBRIC,
    provider: "inception",
    model: MERCURY_QUALITY_MODEL,
    status: "processing",
    overall_score: null,
    verdict: null,
    speaker_confidence: null,
    summary: null,
    criteria: [],
    strengths: [],
    improvements: [],
    objections: [],
    risk_flags: [],
    provider_request_id: null,
    usage: {},
    attempt_count: (existing?.attempt_count ?? 0) + 1,
    requested_by: authorized.profile.id,
    error_message: null,
    processing_started_at: startedAt,
    completed_at: null,
    updated_at: startedAt,
  };

  // Reclamo optimista: evita dos llamadas simultáneas a Mercury para la misma
  // grabación. El intento que pierde la carrera recibe 409 y no consume tokens.
  const processingResult = existing
    ? await admin
        .from("call_quality_evaluations")
        .update(processingPayload)
        .eq("id", existing.id)
        .eq("attempt_count", existing.attempt_count)
        .select("id")
        .maybeSingle()
    : await admin
        .from("call_quality_evaluations")
        .insert(processingPayload)
        .select("id")
        .maybeSingle();
  const { data: processingData, error: processingError } = processingResult;
  if (!processingData && (!processingError || processingError.code === "23505")) {
    return json({ status: "processing", message: "La llamada ya se está auditando." }, 409);
  }
  if (processingError || !processingData) {
    return json({ error: "No se pudo registrar el inicio de la auditoría." }, 500);
  }

  try {
    const result = await evaluateWithMercury({
      apiKey,
      transcriptText: transcription.transcript_text,
      segments: Array.isArray(transcription.segments) ? transcription.segments : [],
      signal: AbortSignal.timeout(240_000),
    });
    const completedAt = new Date().toISOString();
    const { data: completedData, error: completedError } = await admin
      .from("call_quality_evaluations")
      .update({
        status: "completed",
        overall_score: result.overallScore,
        verdict: result.verdict,
        speaker_confidence: result.speakerConfidence,
        summary: result.summary,
        criteria: result.criteria,
        strengths: result.strengths,
        improvements: result.improvements,
        objections: result.objections,
        risk_flags: result.riskFlags,
        provider_request_id: result.providerRequestId,
        usage: result.usage,
        error_message: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", processingData.id)
      .eq("status", "processing")
      .select(EVALUATION_SELECT)
      .single();
    if (completedError || !completedData) throw new Error("No se pudo guardar la auditoría.");
    return json(publicEvaluation(completedData as EvaluationRow));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Error inesperado de auditoría.";
    const failedAt = new Date().toISOString();
    await admin
      .from("call_quality_evaluations")
      .update({ status: "failed", error_message: detail, updated_at: failedAt })
      .eq("id", processingData.id)
      .eq("status", "processing");
    return json({ error: "No se pudo auditar la llamada. Intenta nuevamente." }, 502);
  }
}
