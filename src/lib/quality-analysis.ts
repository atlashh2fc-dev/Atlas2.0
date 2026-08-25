import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SECRETARIA_VIRTUAL_RUBRIC_KEY,
  SECRETARIA_VIRTUAL_RUBRIC_VERSION,
} from "@/lib/secretaria-virtual-quality-rubric";

export type QualityTranscriptionSummary = {
  totalRecordings: number;
  eligibleRecordings: number;
  completed: number;
  processing: number;
  failed: number;
  pending: number;
  transcribedSeconds: number;
  auditableRecordings: number;
  evaluated: number;
  evaluationProcessing: number;
  evaluationFailed: number;
  evaluationPending: number;
  averageScore: number;
};

export type QualityRecentTranscription = {
  recordingId: string;
  recordingStartedAt: string;
  campaignName: string;
  agentName: string;
  status: "pending" | "processing" | "completed" | "failed";
  languageCode: string | null;
  transcriptCharacters: number;
  updatedAt: string;
  evaluationStatus: "pending" | "processing" | "completed" | "failed" | null;
  evaluationScore: number | null;
  evaluationVerdict: "cumple" | "parcial" | "no_cumple" | "no_evaluable" | null;
};

type SummaryRecord = {
  total_recordings?: number | string;
  eligible_recordings?: number | string;
  completed?: number | string;
  processing?: number | string;
  failed?: number | string;
  pending?: number | string;
  transcribed_seconds?: number | string;
  auditable_recordings?: number | string;
  evaluated?: number | string;
  evaluation_processing?: number | string;
  evaluation_failed?: number | string;
  evaluation_pending?: number | string;
  average_score?: number | string;
};

type RecentRecord = {
  recording_id: string;
  recording_started_at: string;
  campaign_id: string;
  agent_id: string | null;
  transcription_status: QualityRecentTranscription["status"];
  language_code: string | null;
  transcript_characters: number | string;
  transcription_updated_at: string;
};

export async function fetchQualityAnalysis(
  supabase: SupabaseClient,
  relatedDataClient: SupabaseClient,
  from: Date,
  to: Date
): Promise<{
  summary: QualityTranscriptionSummary;
  recent: QualityRecentTranscription[];
  error: string | null;
}> {
  const emptySummary: QualityTranscriptionSummary = {
    totalRecordings: 0,
    eligibleRecordings: 0,
    completed: 0,
    processing: 0,
    failed: 0,
    pending: 0,
    transcribedSeconds: 0,
    auditableRecordings: 0,
    evaluated: 0,
    evaluationProcessing: 0,
    evaluationFailed: 0,
    evaluationPending: 0,
    averageScore: 0,
  };

  try {
    const args = { p_from: from.toISOString(), p_to: to.toISOString() };
    const [summaryResult, recentResult] = await Promise.all([
      supabase.rpc("get_quality_transcription_summary", args),
      supabase.rpc("get_quality_recent_transcriptions", { ...args, p_limit: 50 }),
    ]);
    if (summaryResult.error) throw new Error(summaryResult.error.message);
    if (recentResult.error) throw new Error(recentResult.error.message);

    const rawSummary = (summaryResult.data ?? {}) as SummaryRecord;
    const records = (recentResult.data ?? []) as RecentRecord[];
    const campaignIds = [...new Set(records.map((record) => record.campaign_id))];
    const agentIds = [...new Set(records.map((record) => record.agent_id).filter((id): id is string => Boolean(id)))];
    const [campaignsResult, agentsResult, evaluationsResult] = await Promise.all([
      campaignIds.length
        ? relatedDataClient.from("campaigns").select("id, name").in("id", campaignIds)
        : Promise.resolve({ data: [], error: null }),
      agentIds.length
        ? relatedDataClient.from("profiles").select("id, full_name").in("id", agentIds)
        : Promise.resolve({ data: [], error: null }),
      records.length
        ? supabase
            .from("call_quality_evaluations")
            .select("recording_id, status, overall_score, verdict")
            .in("recording_id", records.map((record) => record.recording_id))
            .eq("rubric_key", SECRETARIA_VIRTUAL_RUBRIC_KEY)
            .eq("rubric_version", SECRETARIA_VIRTUAL_RUBRIC_VERSION)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const relatedError = campaignsResult.error ?? agentsResult.error ?? evaluationsResult.error;
    if (relatedError) throw new Error(relatedError.message);

    const campaigns = new Map(
      (campaignsResult.data ?? []).map((campaign) => [campaign.id as string, campaign.name as string])
    );
    const agents = new Map(
      (agentsResult.data ?? []).map((agent) => [agent.id as string, agent.full_name as string])
    );
    const evaluations = new Map(
      (evaluationsResult.data ?? []).map((evaluation) => [
        evaluation.recording_id as string,
        evaluation as {
          status: QualityRecentTranscription["evaluationStatus"];
          overall_score: number | string | null;
          verdict: QualityRecentTranscription["evaluationVerdict"];
        },
      ])
    );

    return {
      summary: {
        totalRecordings: Number(rawSummary.total_recordings ?? 0),
        eligibleRecordings: Number(rawSummary.eligible_recordings ?? 0),
        completed: Number(rawSummary.completed ?? 0),
        processing: Number(rawSummary.processing ?? 0),
        failed: Number(rawSummary.failed ?? 0),
        pending: Number(rawSummary.pending ?? 0),
        transcribedSeconds: Number(rawSummary.transcribed_seconds ?? 0),
        auditableRecordings: Number(rawSummary.auditable_recordings ?? 0),
        evaluated: Number(rawSummary.evaluated ?? 0),
        evaluationProcessing: Number(rawSummary.evaluation_processing ?? 0),
        evaluationFailed: Number(rawSummary.evaluation_failed ?? 0),
        evaluationPending: Number(rawSummary.evaluation_pending ?? 0),
        averageScore: Number(rawSummary.average_score ?? 0),
      },
      recent: records.map((record) => {
        const evaluation = evaluations.get(record.recording_id);
        return {
          recordingId: record.recording_id,
          recordingStartedAt: record.recording_started_at,
          campaignName: campaigns.get(record.campaign_id) ?? "Campaña no disponible",
          agentName: record.agent_id
            ? agents.get(record.agent_id) ?? "Ejecutivo no disponible"
            : "Agente ElevenLabs",
          status: record.transcription_status,
          languageCode: record.language_code,
          transcriptCharacters: Number(record.transcript_characters ?? 0),
          updatedAt: record.transcription_updated_at,
          evaluationStatus: evaluation?.status ?? null,
          evaluationScore:
            evaluation?.overall_score === null || evaluation?.overall_score === undefined
              ? null
              : Number(evaluation.overall_score),
          evaluationVerdict: evaluation?.verdict ?? null,
        };
      }),
      error: null,
    };
  } catch (error) {
    return {
      summary: emptySummary,
      recent: [],
      error: error instanceof Error ? error.message : "No se pudo consultar el análisis de Calidad.",
    };
  }
}
