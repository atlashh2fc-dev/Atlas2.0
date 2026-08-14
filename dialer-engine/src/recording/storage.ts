import { supabase } from "../supabase";
import type {
  RecordingContext,
  RecordingDisconnectParty,
  RecordingIngestGrant,
  RecordingJob,
  RecordingMetadata,
} from "./types";

export async function persistRecordingCompletion(
  dialAttemptId: string,
  completion: { disconnectParty: RecordingDisconnectParty | null; queueTalkSeconds: number | null }
): Promise<void> {
  const values: { disconnect_party?: RecordingDisconnectParty; queue_talk_seconds?: number } = {};
  if (completion.disconnectParty) values.disconnect_party = completion.disconnectParty;
  if (completion.queueTalkSeconds !== null) values.queue_talk_seconds = completion.queueTalkSeconds;
  if (Object.keys(values).length === 0) return;

  const { data, error } = await supabase
    .from("call_recordings")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("dial_attempt_id", dialAttemptId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`call_recordings (completion): ${error.message}`);
  if (!data) throw new Error(`call_recordings (completion): fila no encontrada`);
}

export async function assertPrivateRecordingBucket(bucket: string): Promise<void> {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error) throw new Error(`Storage bucket ${bucket}: ${error.message}`);
  if (data.public) {
    throw new Error(`Storage bucket ${bucket} debe ser privado antes de habilitar grabaciones`);
  }
}

export async function getRecordingContext(
  dialAttemptId: string,
  expectedCallId: string,
  expectedAgentId: string
): Promise<RecordingContext> {
  const { data, error } = await supabase
    .from("dial_attempts")
    .select("call_id, lead_id, campaign_id, agent_id, bridged_at, ended_at")
    .eq("id", dialAttemptId)
    .single();
  if (error) throw new Error(`dial_attempts (recording context): ${error.message}`);
  if (!data.call_id || data.call_id !== expectedCallId) {
    throw new Error(`call_id inconsistente para dial_attempt ${dialAttemptId}`);
  }
  if (!data.agent_id || data.agent_id !== expectedAgentId) {
    throw new Error(`agent_id inconsistente para dial_attempt ${dialAttemptId}`);
  }
  if (!data.bridged_at) throw new Error(`dial_attempt ${dialAttemptId} no está bridgeado`);
  return {
    callId: data.call_id,
    leadId: data.lead_id,
    campaignId: data.campaign_id,
    agentId: data.agent_id,
    startedAt: data.bridged_at,
    endedAt: data.ended_at,
  };
}

export async function persistRecordingState(params: {
  job: RecordingJob;
  bucket: string;
  status: "recording" | "processing" | "uploading" | "ready" | "failed";
  metadata?: RecordingMetadata;
  errorMessage?: string | null;
}): Promise<void> {
  const { job, bucket, status, metadata } = params;
  // La fila nace siempre en createRecordingIngestGrant(). Usar UPSERT aquí
  // hace que Postgres valide primero el tuple candidato a INSERT antes de
  // resolver ON CONFLICT; para status=ready ese tuple no incluye ingested_at
  // y viola ready_payload_check aunque la fila existente sí lo tenga.
  const { data, error } = await supabase
    .from("call_recordings")
    .update({
      dial_attempt_id: job.dialAttemptId,
      call_id: job.callId,
      lead_id: job.leadId,
      campaign_id: job.campaignId,
      agent_id: job.agentId,
      storage_bucket: bucket,
      storage_path: job.storagePath,
      codec: "opus",
      mime_type: "audio/ogg",
      size_bytes: metadata?.sizeBytes ?? null,
      sha256: metadata?.sha256 ?? null,
      duration_seconds: metadata?.durationSeconds ?? null,
      status,
      started_at: job.startedAt,
      ended_at: job.endedAt,
      error_message: params.errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("dial_attempt_id", job.dialAttemptId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`call_recordings (${status}): ${error.message}`);
  if (!data) throw new Error(`call_recordings (${status}): fila no encontrada`);
}

export async function createRecordingIngestGrant(params: {
  job: RecordingJob;
  bucket: string;
  tokenHash: string;
  expiresAt: string;
}): Promise<void> {
  const { job } = params;
  const { error } = await supabase.from("call_recordings").upsert(
    {
      dial_attempt_id: job.dialAttemptId,
      call_id: job.callId,
      lead_id: job.leadId,
      campaign_id: job.campaignId,
      agent_id: job.agentId,
      storage_bucket: params.bucket,
      storage_path: job.storagePath,
      codec: "opus",
      mime_type: "audio/ogg",
      status: "recording",
      started_at: job.startedAt,
      ingest_token_hash: params.tokenHash,
      ingest_expires_at: params.expiresAt,
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "dial_attempt_id" }
  );
  if (error) throw new Error(`call_recordings (ingest grant): ${error.message}`);
}

export async function getRecordingIngestGrant(
  dialAttemptId: string
): Promise<RecordingIngestGrant> {
  const { data, error } = await supabase
    .from("call_recordings")
    .select(
      "dial_attempt_id, call_id, lead_id, campaign_id, agent_id, storage_path, started_at, ended_at, ingest_token_hash, ingest_expires_at, ingested_at, status"
    )
    .eq("dial_attempt_id", dialAttemptId)
    .single();
  if (error) throw new Error(`call_recordings (ingest lookup): ${error.message}`);
  if (!data.ingest_token_hash || !data.ingest_expires_at) {
    throw new Error("La grabación no tiene autorización de ingestión activa");
  }
  return {
    tokenHash: data.ingest_token_hash,
    expiresAt: data.ingest_expires_at,
    ingestedAt: data.ingested_at,
    status: data.status,
    job: {
      version: 1,
      dialAttemptId: data.dial_attempt_id,
      callId: data.call_id,
      leadId: data.lead_id,
      campaignId: data.campaign_id,
      agentId: data.agent_id,
      channel: "",
      startedAt: data.started_at,
      endedAt: data.ended_at,
      wavPath: "",
      opusPath: "",
      storagePath: data.storage_path,
    },
  };
}

export async function markRecordingIngested(dialAttemptId: string): Promise<void> {
  const { error } = await supabase
    .from("call_recordings")
    .update({ ingested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("dial_attempt_id", dialAttemptId)
    .is("ingested_at", null);
  if (error) throw new Error(`call_recordings (ingested): ${error.message}`);
}

function remoteMetadataMatches(
  data: { size?: number; metadata?: Record<string, unknown> },
  metadata: RecordingMetadata
): boolean {
  const remote = data.metadata ?? {};
  const nested =
    typeof remote.metadata === "object" && remote.metadata !== null
      ? (remote.metadata as Record<string, unknown>)
      : {};
  const remoteHash = remote.sha256 ?? nested.sha256;
  const remoteSize = data.size ?? remote.size ?? nested.size_bytes;
  return remoteHash === metadata.sha256 && Number(remoteSize) === metadata.sizeBytes;
}

export async function uploadRecordingIdempotently(params: {
  bucket: string;
  job: RecordingJob;
  metadata: RecordingMetadata;
  body: Buffer;
}): Promise<void> {
  const api = supabase.storage.from(params.bucket);
  const existing = await api.info(params.job.storagePath);
  if (!existing.error) {
    if (!remoteMetadataMatches(existing.data, params.metadata)) {
      throw new Error(`El objeto ${params.job.storagePath} ya existe con hash/tamaño diferente`);
    }
    return;
  }

  // info() devuelve error para 404; cualquier otro problema se comprobará de
  // nuevo después del upload sin permitir overwrite.
  const { error } = await api.upload(params.job.storagePath, params.body, {
    upsert: false,
    contentType: "audio/ogg",
    cacheControl: "300",
    metadata: {
      sha256: params.metadata.sha256,
      size_bytes: params.metadata.sizeBytes,
      dial_attempt_id: params.job.dialAttemptId,
      call_id: params.job.callId,
    },
  });

  if (error) {
    // Puede ser el reintento posterior a una respuesta perdida. La lectura de
    // metadata decide si es nuestro mismo objeto; nunca se usa upsert=true.
    const afterConflict = await api.info(params.job.storagePath);
    if (afterConflict.error || !remoteMetadataMatches(afterConflict.data, params.metadata)) {
      throw new Error(`Storage upload ${params.job.storagePath}: ${error.message}`);
    }
    return;
  }

  const verified = await api.info(params.job.storagePath);
  if (verified.error || !remoteMetadataMatches(verified.data, params.metadata)) {
    throw new Error(`No se pudo verificar hash/tamaño de ${params.job.storagePath} después del upload`);
  }
}
