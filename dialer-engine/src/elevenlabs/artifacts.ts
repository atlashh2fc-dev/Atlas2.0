import { createHash } from "node:crypto";
import { supabase } from "../supabaseClient";
import { getElevenLabsConversationAudio, type ElevenLabsConversation } from "./client";

const RECORDING_BUCKET = "call-recordings";
const PREVER_STATUS = new Set([
  "Cliente responde llamada",
  "Cliente no responde llamada",
  "Cliente NO desea responder",
  "Cliente corta la llamada",
  "Cliente solicita llamar mas tarde",
  "Numero equivocado",
  "Otros",
]);

type AttemptContext = {
  id: string;
  campaign_id: string;
  lead_id: string;
  provider_conversation_id: string;
  leads: { team_id: string | null } | Array<{ team_id: string | null }> | null;
};

function firstRelated<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function collectedValue(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const record = entry as Record<string, unknown>;
  if ("value" in record) return record.value;
  if ("result" in record) return record.result;
  if ("data" in record) return record.data;
  return null;
}

function textValue(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  return text || null;
}

function integerValue(value: unknown, min: number, max: number): number | null {
  const parsed = Number(textValue(value));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function yesNoValue(value: unknown): "SI" | "NO" | null {
  const normalized = textValue(value)?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalized === "SI") return "SI";
  if (normalized === "NO") return "NO";
  return null;
}

function callStatusValue(value: unknown): string | null {
  const status = textValue(value);
  return status && PREVER_STATUS.has(status) ? status : null;
}

function inferredCallStatus(conversation: ElevenLabsConversation): string | null {
  if (conversation.has_user_audio === false) return "Cliente no responde llamada";
  const reason = textValue(conversation.metadata?.termination_reason)?.toLowerCase() ?? "";
  if (/no[_ -]?answer|voicemail|unanswered|not[_ -]?answered/.test(reason)) {
    return "Cliente no responde llamada";
  }
  return null;
}

function transcriptText(conversation: ElevenLabsConversation): string {
  return (conversation.transcript ?? [])
    .map((turn) => {
      const message = textValue(turn.message);
      if (!message) return null;
      const speaker = turn.role === "agent" ? "Agente" : turn.role === "user" ? "Cliente" : "Sistema";
      return `${speaker}: ${message}`;
    })
    .filter((turn): turn is string => Boolean(turn))
    .join("\n");
}

function transcriptSegments(conversation: ElevenLabsConversation) {
  return (conversation.transcript ?? [])
    .map((turn) => ({
      role: turn.role ?? null,
      start: typeof turn.time_in_call_secs === "number" ? turn.time_in_call_secs : null,
      text: textValue(turn.message),
    }))
    .filter((segment) => segment.text);
}

function conversationTimes(conversation: ElevenLabsConversation) {
  const duration = Math.max(0, Number(conversation.metadata?.call_duration_secs ?? 0));
  const startUnix = Number(conversation.metadata?.start_time_unix_secs ?? 0);
  const endedAt = new Date();
  const startedAt = startUnix > 0
    ? new Date(startUnix * 1000)
    : new Date(endedAt.getTime() - duration * 1000);
  return { duration, startedAt, endedAt: new Date(startedAt.getTime() + duration * 1000) };
}

function storagePath(conversationId: string, startedAt: Date): string {
  const year = startedAt.getUTCFullYear();
  const month = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(startedAt.getUTCDate()).padStart(2, "0");
  return `elevenlabs/${year}/${month}/${day}/${conversationId}.mp3`;
}

async function getAttemptContext(dialAttemptId: string): Promise<AttemptContext> {
  const { data, error } = await supabase
    .from("dial_attempts")
    .select("id,campaign_id,lead_id,provider_conversation_id,leads(team_id)")
    .eq("id", dialAttemptId)
    .single();
  if (error) throw new Error(`dial_attempts (ElevenLabs artifacts): ${error.message}`);
  return data as unknown as AttemptContext;
}

async function uploadAudioIdempotently(path: string, body: Buffer, sha256: string): Promise<void> {
  const storage = supabase.storage.from(RECORDING_BUCKET);
  const existing = await storage.info(path);
  if (!existing.error) {
    const metadata = (existing.data.metadata ?? {}) as Record<string, unknown>;
    const nested = typeof metadata.metadata === "object" && metadata.metadata !== null
      ? metadata.metadata as Record<string, unknown>
      : {};
    const remoteHash = metadata.sha256 ?? nested.sha256;
    if (remoteHash !== sha256 || Number(existing.data.size) !== body.byteLength) {
      throw new Error(`El audio ${path} ya existe con hash o tamano diferente`);
    }
    return;
  }

  const { error } = await storage.upload(path, body, {
    upsert: false,
    contentType: "audio/mpeg",
    cacheControl: "300",
    metadata: { sha256, size_bytes: body.byteLength },
  });
  if (!error) return;

  const afterConflict = await storage.info(path);
  const metadata = (afterConflict.data?.metadata ?? {}) as Record<string, unknown>;
  const nested = typeof metadata.metadata === "object" && metadata.metadata !== null
    ? metadata.metadata as Record<string, unknown>
    : {};
  if (
    afterConflict.error
    || (metadata.sha256 ?? nested.sha256) !== sha256
    || Number(afterConflict.data.size) !== body.byteLength
  ) {
    throw new Error(`Storage upload ${path}: ${error.message}`);
  }
}

async function persistPreverResult(
  attempt: AttemptContext,
  conversation: ElevenLabsConversation,
  startedAt: Date,
  endedAt: Date
): Promise<void> {
  const collected = conversation.analysis?.data_collection_results ?? {};
  const values = Object.fromEntries(
    Object.entries(collected).map(([key, entry]) => [
      typeof entry?.data_collection_id === "string" && entry.data_collection_id.trim()
        ? entry.data_collection_id
        : key,
      collectedValue(entry),
    ])
  );
  const q4 = yesNoValue(values.q4_benefits_advice);

  const { error } = await supabase.from("prever_survey_results").upsert({
    dial_attempt_id: attempt.id,
    campaign_id: attempt.campaign_id,
    lead_id: attempt.lead_id,
    provider_conversation_id: conversation.conversation_id,
    call_status: callStatusValue(values.call_status) ?? inferredCallStatus(conversation),
    respondent_name: textValue(values.respondent_name),
    q1_service_general: integerValue(values.q1_service_general, 1, 7),
    q2_information: integerValue(values.q2_information, 1, 7),
    q3_commitments: integerValue(values.q3_commitments, 1, 7),
    q4_benefits_advice: q4,
    q5_no_advice_reason: q4 === "NO" ? textValue(values.q5_no_advice_reason) : null,
    q6_funeral_service: integerValue(values.q6_funeral_service, 1, 7),
    q7_service_times: integerValue(values.q7_service_times, 1, 7),
    q8_overall_satisfaction: integerValue(values.q8_overall_satisfaction, 1, 7),
    q9_recommendation: integerValue(values.q9_recommendation, 0, 10),
    q10_comments: textValue(values.q10_comments),
    transcript: conversation.transcript ?? [],
    analysis: conversation.analysis ?? {},
    collected_data: values,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "dial_attempt_id" });
  if (error) throw new Error(`prever_survey_results: ${error.message}`);
}

export async function persistCompletedElevenLabsArtifacts(params: {
  apiKey: string;
  dialAttemptId: string;
  surveySchema: string | null;
  conversation: ElevenLabsConversation;
}): Promise<void> {
  const { conversation } = params;
  if (conversation.status !== "done") return;

  const attempt = await getAttemptContext(params.dialAttemptId);
  if (attempt.provider_conversation_id !== conversation.conversation_id) {
    throw new Error("La conversacion ElevenLabs no corresponde al intento Atlas");
  }

  const { duration, startedAt, endedAt } = conversationTimes(conversation);
  if (params.surveySchema === "prever_v1") {
    await persistPreverResult(attempt, conversation, startedAt, endedAt);
  }

  if (!conversation.has_audio) return;

  const audio = await getElevenLabsConversationAudio(params.apiKey, conversation.conversation_id);
  if (audio.body.byteLength === 0) throw new Error("ElevenLabs devolvio una grabacion vacia");
  const sha256 = createHash("sha256").update(audio.body).digest("hex");
  const path = storagePath(conversation.conversation_id, startedAt);
  await uploadAudioIdempotently(path, audio.body, sha256);

  const teamId = firstRelated(attempt.leads)?.team_id ?? null;
  const { data: recording, error: recordingError } = await supabase
    .from("call_recordings")
    .upsert({
      dial_attempt_id: attempt.id,
      call_id: null,
      lead_id: attempt.lead_id,
      campaign_id: attempt.campaign_id,
      agent_id: null,
      team_id: teamId,
      source: "elevenlabs",
      provider_conversation_id: conversation.conversation_id,
      provider_agent_name: textValue(conversation.agent_name) ?? "Agente ElevenLabs",
      storage_bucket: RECORDING_BUCKET,
      storage_path: path,
      codec: "mp3",
      mime_type: "audio/mpeg",
      size_bytes: audio.body.byteLength,
      sha256,
      duration_seconds: duration,
      status: "ready",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      ingested_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "dial_attempt_id" })
    .select("id")
    .single();
  if (recordingError) throw new Error(`call_recordings (ElevenLabs): ${recordingError.message}`);

  const text = transcriptText(conversation);
  if (!text) return;
  const { error: transcriptError } = await supabase.from("call_transcriptions").upsert({
    recording_id: recording.id,
    provider: "elevenlabs",
    model: "conversation-transcript",
    source_sha256: sha256,
    status: "completed",
    language_code: "es",
    transcript_text: text,
    segments: transcriptSegments(conversation),
    words: [],
    attempt_count: 1,
    error_message: null,
    processing_started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "recording_id" });
  if (transcriptError) throw new Error(`call_transcriptions (ElevenLabs): ${transcriptError.message}`);
}
