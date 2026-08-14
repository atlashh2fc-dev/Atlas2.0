import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  GROQ_TRANSCRIPTION_MAX_BYTES,
  GROQ_TRANSCRIPTION_MODEL,
  transcribeWithGroq,
} from "@/lib/groq-transcription";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { evaluateQualityTranscriptionEligibility } from "@/lib/quality-transcription-policy";

export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROCESSING_STALE_MS = 10 * 60 * 1000;

type RecordingRow = {
  id: string;
  call_id: string;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
  sha256: string | null;
  duration_seconds: number | string | null;
  queue_talk_seconds: number | string | null;
  status: string;
};

type TranscriptionRow = {
  id: string;
  recording_id: string;
  source_sha256: string;
  status: "pending" | "processing" | "completed" | "failed";
  language_code: string | null;
  transcript_text: string | null;
  segments: unknown[];
  words: unknown[];
  attempt_count: number;
  processing_started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

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
    return { error: json({ error: "No tienes permiso para transcribir grabaciones." }, 403) } as const;
  }
  if (!UUID_PATTERN.test(id)) return { error: json({ error: "Grabación inválida." }, 400) } as const;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_recordings")
    .select("id, call_id, storage_bucket, storage_path, mime_type, size_bytes, sha256, duration_seconds, queue_talk_seconds, status")
    .eq("id", id)
    .maybeSingle();

  if (error) return { error: json({ error: "No se pudo consultar la grabación." }, 500) } as const;
  if (!data) {
    return { error: json({ error: "La grabación no existe o no está dentro de tu alcance." }, 404) } as const;
  }

  return { profile, supabase, recording: data as RecordingRow } as const;
}

function publicTranscription(row: TranscriptionRow) {
  return {
    id: row.id,
    status: row.status,
    languageCode: row.language_code,
    text: row.transcript_text,
    segments: Array.isArray(row.segments) ? row.segments : [],
    words: Array.isArray(row.words) ? row.words : [],
    completedAt: row.completed_at,
    error: row.status === "failed" ? "La transcripción falló. Puedes reintentar." : null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await authorizeRecording(id);
  if ("error" in authorized) return authorized.error;

  const { data, error } = await authorized.supabase
    .from("call_transcriptions")
    .select(
      "id, recording_id, source_sha256, status, language_code, transcript_text, segments, words, attempt_count, processing_started_at, completed_at, error_message"
    )
    .eq("recording_id", id)
    .maybeSingle();

  if (error) return json({ error: "No se pudo consultar la transcripción." }, 500);
  if (!data) return json({ status: "pending", text: null, segments: [], words: [] });
  return json(publicTranscription(data as TranscriptionRow));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authorized = await authorizeRecording(id);
  if ("error" in authorized) return authorized.error;

  const { profile, recording } = authorized;
  if (recording.status !== "ready" || !recording.storage_path || !recording.sha256) {
    return json({ error: "La grabación todavía no está disponible para transcribir." }, 409);
  }

  const admin = createAdminClient();
  const { data: call, error: callError } = await admin
    .from("calls")
    .select("outcome")
    .eq("id", recording.call_id)
    .maybeSingle();
  if (callError || !call) return json({ error: "No se pudo validar la tipificación de la llamada." }, 500);

  const eligibility = evaluateQualityTranscriptionEligibility({
    recordingStatus: recording.status,
    durationSeconds: recording.duration_seconds === null ? null : Number(recording.duration_seconds),
    queueTalkSeconds: recording.queue_talk_seconds === null ? null : Number(recording.queue_talk_seconds),
    outcome: call.outcome as string | null,
  });
  if (!eligibility.eligible) {
    return json({ error: `Esta llamada no fue seleccionada: ${eligibility.label}.` }, 422);
  }

  const sizeBytes = Number(recording.size_bytes ?? 0);
  if (sizeBytes <= 0 || sizeBytes > GROQ_TRANSCRIPTION_MAX_BYTES) {
    return json({ error: "El audio supera el máximo de 25 MB permitido por el plan gratuito." }, 413);
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return json({ error: "Falta configurar GROQ_API_KEY en el entorno de producción." }, 503);
  }

  const { data: existingData, error: existingError } = await admin
    .from("call_transcriptions")
    .select(
      "id, recording_id, source_sha256, status, language_code, transcript_text, segments, words, attempt_count, processing_started_at, completed_at, error_message"
    )
    .eq("recording_id", recording.id)
    .maybeSingle();
  if (existingError) return json({ error: "No se pudo preparar la transcripción." }, 500);

  const existing = existingData as TranscriptionRow | null;
  if (existing?.status === "completed" && existing.source_sha256 === recording.sha256) {
    return json(publicTranscription(existing));
  }
  if (
    existing?.status === "processing" &&
    existing.processing_started_at &&
    Date.now() - new Date(existing.processing_started_at).getTime() < PROCESSING_STALE_MS
  ) {
    return json({ status: "processing", message: "La grabación ya se está transcribiendo." }, 409);
  }

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
        requested_by: profile.id,
        error_message: null,
        processing_started_at: startedAt,
        completed_at: null,
        attempt_count: (existing?.attempt_count ?? 0) + 1,
        updated_at: startedAt,
      },
      { onConflict: "recording_id" }
    )
    .select("id")
    .single();
  if (processingError || !processingData) {
    return json({ error: "No se pudo registrar el inicio de la transcripción." }, 500);
  }

  try {
    const { data: audio, error: downloadError } = await admin.storage
      .from(recording.storage_bucket)
      .download(recording.storage_path);
    if (downloadError || !audio) throw new Error("No se pudo descargar el audio privado.");

    const actualSize = audio.size;
    if (actualSize <= 0 || actualSize > GROQ_TRANSCRIPTION_MAX_BYTES) {
      throw new Error("El audio supera el máximo de 25 MB permitido por el plan gratuito.");
    }

    const requestId = crypto.randomUUID();
    const { error: auditError } = await admin.from("call_recording_access_logs").insert({
      recording_id: recording.id,
      actor_id: profile.id,
      actor_role: profile.role,
      action: "downloaded",
      request_id: requestId,
      user_agent: request.headers.get("user-agent"),
      metadata: { purpose: "transcription", provider: "groq", model: GROQ_TRANSCRIPTION_MODEL },
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
      .select(
        "id, recording_id, source_sha256, status, language_code, transcript_text, segments, words, attempt_count, processing_started_at, completed_at, error_message"
      )
      .single();
    if (completedError || !completedData) throw new Error("No se pudo guardar la transcripción.");

    return json(publicTranscription(completedData as TranscriptionRow));
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Error inesperado de transcripción.";
    const failedAt = new Date().toISOString();
    await admin
      .from("call_transcriptions")
      .update({ status: "failed", error_message: detail, updated_at: failedAt })
      .eq("id", processingData.id)
      .eq("status", "processing");

    return json({ error: "No se pudo transcribir la grabación. Intenta nuevamente." }, 502);
  }
}
