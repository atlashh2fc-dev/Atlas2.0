import type { SupabaseClient } from "@supabase/supabase-js";

export type QualityTranscriptionSummary = {
  totalRecordings: number;
  eligibleRecordings: number;
  completed: number;
  processing: number;
  failed: number;
  pending: number;
  transcribedSeconds: number;
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
};

type SummaryRecord = {
  total_recordings?: number | string;
  eligible_recordings?: number | string;
  completed?: number | string;
  processing?: number | string;
  failed?: number | string;
  pending?: number | string;
  transcribed_seconds?: number | string;
};

type RecentRecord = {
  recording_id: string;
  recording_started_at: string;
  campaign_id: string;
  agent_id: string;
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
    const agentIds = [...new Set(records.map((record) => record.agent_id))];
    const [campaignsResult, agentsResult] = await Promise.all([
      campaignIds.length
        ? relatedDataClient.from("campaigns").select("id, name").in("id", campaignIds)
        : Promise.resolve({ data: [], error: null }),
      agentIds.length
        ? relatedDataClient.from("profiles").select("id, full_name").in("id", agentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const relatedError = campaignsResult.error ?? agentsResult.error;
    if (relatedError) throw new Error(relatedError.message);

    const campaigns = new Map(
      (campaignsResult.data ?? []).map((campaign) => [campaign.id as string, campaign.name as string])
    );
    const agents = new Map(
      (agentsResult.data ?? []).map((agent) => [agent.id as string, agent.full_name as string])
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
      },
      recent: records.map((record) => ({
        recordingId: record.recording_id,
        recordingStartedAt: record.recording_started_at,
        campaignName: campaigns.get(record.campaign_id) ?? "Campaña no disponible",
        agentName: agents.get(record.agent_id) ?? "Ejecutivo no disponible",
        status: record.transcription_status,
        languageCode: record.language_code,
        transcriptCharacters: Number(record.transcript_characters ?? 0),
        updatedAt: record.transcription_updated_at,
      })),
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
