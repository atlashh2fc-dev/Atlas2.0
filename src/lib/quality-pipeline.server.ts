import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GROQ_TRANSCRIPTION_MAX_BYTES,
  GROQ_TRANSCRIPTION_MODEL,
  transcribeWithGroq,
} from "@/lib/groq-transcription";
import { evaluatePautaWithMercury } from "@/lib/mercury-pauta-evaluation";
import { MERCURY_QUALITY_MODEL } from "@/lib/mercury-quality-evaluation";
import {
  mapPautaRow,
  PAUTA_COLUMNS,
  pautaRubricKey,
  selectRubric,
  type QualityPauta,
} from "@/lib/quality-pauta";
import type { AppRole } from "@/lib/types";

/**
 * Transcribir y evaluar una grabación contra la pauta vigente de su campaña.
 *
 * Lo usan la pantalla (con la persona que lo pide como actor) y la muestra
 * automática (sin actor). Todo se escribe con la service role, después de que
 * quien llama ya autorizó el acceso a la grabación.
 */

const PROCESSING_STALE_MS = 10 * 60 * 1000;

export class QualityPipelineError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

export type PipelineActor = { id: string | null; role: AppRole | null; userAgent?: string | null; origin: "manual" | "muestra" };

type RecordingForPipeline = {
  id: string;
  call_id: string | null;
  campaign_id: string;
  storage_bucket: string;
  storage_path: string | null;
  size_bytes: number | string | null;
  sha256: string | null;
  status: string;
};

type TranscriptionRow = {
  id: string;
  source_sha256: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript_text: string | null;
  segments: { start?: number; end?: number; text?: string }[];
  attempt_count: number;
  processing_started_at: string | null;
};

const RECORDING_COLUMNS = "id, call_id, campaign_id, storage_bucket, storage_path, size_bytes, sha256, status";
const TRANSCRIPTION_COLUMNS = "id, source_sha256, status, transcript_text, segments, attempt_count, processing_started_at";

/** Pauta vigente que cubre la campaña, o null si la campaña no tiene pauta. */
export async function vigentePautaForCampaign(admin: SupabaseClient, campaignId: string): Promise<QualityPauta | null> {
  const { data, error } = await admin
    .from("quality_pautas")
    .select(PAUTA_COLUMNS)
    .eq("status", "vigente")
    .contains("campaign_ids", [campaignId])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new QualityPipelineError("No se pudo consultar la pauta de la campaña.", 500);
  return data ? mapPautaRow(data as Record<string, unknown>) : null;
}

/** Pautas vigentes de una empresa. */
export async function vigentePautas(client: SupabaseClient, organizationId?: string): Promise<QualityPauta[]> {
  let query = client.from("quality_pautas").select(PAUTA_COLUMNS).eq("status", "vigente");
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query.order("name");
  if (error) return [];
  return (data ?? []).map((row) => mapPautaRow(row as Record<string, unknown>));
}

async function loadRecording(admin: SupabaseClient, recordingId: string) {
  const { data, error } = await admin.from("call_recordings").select(RECORDING_COLUMNS).eq("id", recordingId).maybeSingle();
  if (error || !data) throw new QualityPipelineError("No se pudo consultar la grabación.", 500);
  return data as RecordingForPipeline;
}

/** Deja la grabación transcrita (o devuelve la transcripción vigente). */
export async function ensureTranscription(admin: SupabaseClient, recordingId: string, actor: PipelineActor) {
  const recording = await loadRecording(admin, recordingId);
  if (recording.status !== "ready" || !recording.storage_path || !recording.sha256) {
    throw new QualityPipelineError("La grabación todavía no está disponible para transcribir.", 409);
  }
  const sizeBytes = Number(recording.size_bytes ?? 0);
  if (sizeBytes <= 0 || sizeBytes > GROQ_TRANSCRIPTION_MAX_BYTES) {
    throw new QualityPipelineError("El audio supera el máximo de 25 MB que acepta la transcripción.", 413);
  }

  const { data: existingData, error: existingError } = await admin
    .from("call_transcriptions")
    .select(TRANSCRIPTION_COLUMNS)
    .eq("recording_id", recording.id)
    .maybeSingle();
  if (existingError) throw new QualityPipelineError("No se pudo preparar la transcripción.", 500);
  const existing = existingData as TranscriptionRow | null;
  if (existing?.status === "completed" && existing.source_sha256 === recording.sha256) return existing;
  if (
    existing?.status === "processing" &&
    existing.processing_started_at &&
    Date.now() - new Date(existing.processing_started_at).getTime() < PROCESSING_STALE_MS
  ) {
    throw new QualityPipelineError("La grabación ya se está transcribiendo.", 409, "processing");
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new QualityPipelineError("Falta configurar GROQ_API_KEY en el entorno de producción.", 503);

  const startedAt = new Date().toISOString();
  const { data: processingData, error: processingError } = await admin
    .from("call_transcriptions")
    .upsert(
      {
        recording_id: recording.id,
        provider: "groq",
        model: GROQ_TRANSCRIPTION_MODEL,
        source_sha256: recording.sha256,
        status: "processing",
        transcript_text: null,
        segments: [],
        words: [],
        requested_by: actor.id,
        error_message: null,
        processing_started_at: startedAt,
        completed_at: null,
        attempt_count: (existing?.attempt_count ?? 0) + 1,
        updated_at: startedAt,
      },
      { onConflict: "recording_id" },
    )
    .select("id")
    .single();
  if (processingError || !processingData) {
    throw new QualityPipelineError("No se pudo registrar el inicio de la transcripción.", 500);
  }

  try {
    const { data: audio, error: downloadError } = await admin.storage.from(recording.storage_bucket).download(recording.storage_path);
    if (downloadError || !audio) throw new Error("No se pudo descargar el audio privado.");
    if (audio.size <= 0 || audio.size > GROQ_TRANSCRIPTION_MAX_BYTES) {
      throw new Error("El audio supera el máximo de 25 MB que acepta la transcripción.");
    }

    const { error: auditError } = await admin.from("call_recording_access_logs").insert({
      recording_id: recording.id,
      actor_id: actor.id,
      actor_role: actor.role,
      action: "downloaded",
      request_id: crypto.randomUUID(),
      user_agent: actor.userAgent ?? null,
      metadata: { purpose: "transcription", provider: "groq", model: GROQ_TRANSCRIPTION_MODEL, origin: actor.origin },
    });
    if (auditError) throw new Error("No se pudo auditar el acceso al audio.");

    const result = await transcribeWithGroq({
      apiKey,
      audio,
      fileName: `${recording.id}.ogg`,
      signal: AbortSignal.timeout(240_000),
    });
    const completedAt = new Date().toISOString();
    const { data: completedData, error: completedError } = await admin
      .from("call_transcriptions")
      .update({
        status: "completed",
        language_code: result.language,
        transcript_text: result.text,
        segments: result.segments,
        words: result.words,
        provider_request_id: result.requestId,
        error_message: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", processingData.id)
      .eq("status", "processing")
      .select(TRANSCRIPTION_COLUMNS)
      .single();
    if (completedError || !completedData) throw new Error("No se pudo guardar la transcripción.");
    return completedData as TranscriptionRow;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Error inesperado de transcripción.";
    await admin
      .from("call_transcriptions")
      .update({ status: "failed", error_message: detail, updated_at: new Date().toISOString() })
      .eq("id", processingData.id)
      .eq("status", "processing");
    throw new QualityPipelineError("No se pudo transcribir la grabación. Intenta nuevamente.", 502);
  }
}

export const PAUTA_EVALUATION_COLUMNS =
  "id, recording_id, transcription_id, transcription_source_sha256, rubric_key, rubric_version, rubric_name, rubric_snapshot, pauta_id, status, overall_score, verdict, invalid_reason, critical_errors, non_critical_errors, speaker_confidence, summary, criteria, strengths, improvements, objections, risk_flags, attempt_count, processing_started_at, completed_at, error_message, updated_at";

type EvaluationRow = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcription_source_sha256: string;
  attempt_count: number;
  processing_started_at: string | null;
};

/**
 * Transcribe si hace falta y evalúa con la rúbrica que corresponde a la
 * tipificación. Si ya existe una evaluación completa sobre la misma
 * transcripción, la devuelve sin volver a gastar en la IA (salvo `force`).
 */
export async function evaluateRecordingWithPauta(
  admin: SupabaseClient,
  recordingId: string,
  actor: PipelineActor,
  options: { force?: boolean } = {},
) {
  const recording = await loadRecording(admin, recordingId);
  const pauta = await vigentePautaForCampaign(admin, recording.campaign_id);
  if (!pauta) throw new QualityPipelineError("Esta campaña no tiene una pauta de calidad vigente.", 422, "sin_pauta");

  const apiKey = process.env.INCEPTION_API_KEY?.trim();
  if (!apiKey) throw new QualityPipelineError("Falta configurar INCEPTION_API_KEY en el entorno de producción.", 503);

  const [callResult, campaignResult] = await Promise.all([
    recording.call_id
      ? admin.from("calls").select("outcome, reason").eq("id", recording.call_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("campaigns").select("name").eq("id", recording.campaign_id).maybeSingle(),
  ]);
  const call = callResult.data as { outcome: string | null; reason: string | null } | null;
  const rubric = selectRubric(pauta, call?.outcome ?? null);
  if (!rubric) throw new QualityPipelineError("La pauta vigente no tiene rúbricas.", 422);

  const transcription = await ensureTranscription(admin, recordingId, actor);
  if (!transcription.transcript_text?.trim()) {
    throw new QualityPipelineError("La transcripción quedó vacía; revisa el audio.", 409);
  }

  const rubricKey = pautaRubricKey(pauta.key, rubric.key);
  const { data: existingData, error: existingError } = await admin
    .from("call_quality_evaluations")
    .select("id, status, transcription_source_sha256, attempt_count, processing_started_at")
    .eq("recording_id", recordingId)
    .eq("rubric_key", rubricKey)
    .eq("rubric_version", pauta.version)
    .maybeSingle();
  if (existingError) throw new QualityPipelineError("No se pudo preparar la evaluación.", 500);
  const existing = existingData as EvaluationRow | null;

  if (existing?.status === "completed" && existing.transcription_source_sha256 === transcription.source_sha256 && !options.force) {
    return { evaluationId: existing.id, reused: true };
  }
  if (
    existing?.status === "processing" &&
    existing.processing_started_at &&
    Date.now() - new Date(existing.processing_started_at).getTime() < PROCESSING_STALE_MS
  ) {
    throw new QualityPipelineError("La llamada ya se está evaluando.", 409, "processing");
  }

  const startedAt = new Date().toISOString();
  const snapshot = {
    pauta: { id: pauta.id, key: pauta.key, version: pauta.version, name: pauta.name },
    rubric,
    scale: pauta.scale,
    objective: pauta.objective,
  };
  const processingPayload = {
    recording_id: recordingId,
    transcription_id: transcription.id,
    transcription_source_sha256: transcription.source_sha256,
    rubric_key: rubricKey,
    rubric_version: pauta.version,
    rubric_name: `${pauta.name} · ${rubric.name}`,
    rubric_snapshot: snapshot,
    pauta_id: pauta.id,
    provider: "inception",
    model: MERCURY_QUALITY_MODEL,
    status: "processing",
    overall_score: null,
    verdict: null,
    invalid_reason: null,
    critical_errors: null,
    non_critical_errors: null,
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
    requested_by: actor.id,
    error_message: null,
    processing_started_at: startedAt,
    completed_at: null,
    updated_at: startedAt,
  };

  // Reclamo optimista: dos pedidos simultáneos no pagan dos veces la IA.
  const claim = existing
    ? await admin
        .from("call_quality_evaluations")
        .update(processingPayload)
        .eq("id", existing.id)
        .eq("attempt_count", existing.attempt_count)
        .select("id")
        .maybeSingle()
    : await admin.from("call_quality_evaluations").insert(processingPayload).select("id").maybeSingle();
  if (!claim.data && (!claim.error || claim.error.code === "23505")) {
    throw new QualityPipelineError("La llamada ya se está evaluando.", 409, "processing");
  }
  if (claim.error || !claim.data) throw new QualityPipelineError("No se pudo registrar el inicio de la evaluación.", 500);
  const evaluationId = claim.data.id as string;

  try {
    const result = await evaluatePautaWithMercury({
      apiKey,
      pautaName: pauta.name,
      rubric,
      scale: pauta.scale,
      campaignName: (campaignResult.data as { name: string } | null)?.name ?? "Campaña",
      typification: call?.reason ?? null,
      transcriptText: transcription.transcript_text,
      segments: Array.isArray(transcription.segments) ? transcription.segments : [],
      signal: AbortSignal.timeout(240_000),
    });
    const completedAt = new Date().toISOString();
    const { error: completedError } = await admin
      .from("call_quality_evaluations")
      .update({
        status: "completed",
        overall_score: result.overallScore,
        verdict: result.verdict,
        invalid_reason: result.invalidReason,
        critical_errors: result.criticalErrors,
        non_critical_errors: result.nonCriticalErrors,
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
      .eq("id", evaluationId)
      .eq("status", "processing");
    if (completedError) throw new Error("No se pudo guardar la evaluación.");
    return { evaluationId, reused: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Error inesperado de evaluación.";
    await admin
      .from("call_quality_evaluations")
      .update({ status: "failed", error_message: detail, updated_at: new Date().toISOString() })
      .eq("id", evaluationId)
      .eq("status", "processing");
    throw new QualityPipelineError("No se pudo evaluar la llamada. Intenta nuevamente.", 502);
  }
}
