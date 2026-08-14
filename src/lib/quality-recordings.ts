import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { resolveReportRange } from "@/lib/report-range";
import {
  evaluateQualityTranscriptionEligibility,
  type QualityTranscriptionEligibility,
} from "@/lib/quality-transcription-policy";

export const RECORDINGS_PAGE_SIZE = 50;

export type RecordingStatus =
  | "recording"
  | "processing"
  | "uploading"
  | "ready"
  | "failed"
  | "archived"
  | "deleted";
export type RecordingDisconnectParty = "caller" | "agent" | "transfer";
export type QualityTranscriptionStatus = "pending" | "processing" | "completed" | "failed";

export type RecordingFilters = {
  campaign: string;
  agent: string;
  rut: string;
  from: string;
  to: string;
};

export type QualityRecordingRow = {
  id: string;
  callId: string;
  leadId: string;
  campaignId: string;
  campaignName: string;
  agentId: string;
  agentName: string;
  typification: string | null;
  callEndedAt: string | null;
  callDiscardedReason: string | null;
  callOutcome: string | null;
  disconnectParty: RecordingDisconnectParty | null;
  queueTalkSeconds: number | null;
  leadName: string;
  rut: string;
  startedAt: string;
  durationSeconds: number | null;
  codec: string | null;
  sizeBytes: number | null;
  endedAt: string | null;
  status: RecordingStatus;
  transcriptionStatus: QualityTranscriptionStatus | null;
  transcriptionEligibility: QualityTranscriptionEligibility;
};

export type QualityRecordingsPage = {
  rows: QualityRecordingRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  error: string | null;
};

type RecordingRecord = {
  id: string;
  call_id: string;
  lead_id: string;
  campaign_id: string;
  agent_id: string;
  started_at: string;
  duration_seconds: number | string | null;
  codec: string | null;
  size_bytes: number | string | null;
  disconnect_party: RecordingDisconnectParty | null;
  queue_talk_seconds: number | string | null;
  ended_at: string | null;
  status: RecordingStatus;
};

async function supervisorTeamIds(supabase: SupabaseClient, profileId: string): Promise<string[]> {
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id")
    .eq("supervisor_id", profileId);
  if (teamsError) throw new Error(teamsError.message);
  return (teams ?? []).map((team) => team.id as string);
}

/**
 * Read model del menú Calidad. La sesión del usuario y RLS son la primera
 * frontera; el filtro por equipos supervisados agrega defensa en profundidad.
 */
export async function fetchQualityRecordings(
  supabase: SupabaseClient,
  profile: Pick<Profile, "id" | "role">,
  filters: RecordingFilters,
  requestedPage: number,
  relatedDataClient: SupabaseClient = supabase
): Promise<QualityRecordingsPage> {
  const pageSize = RECORDINGS_PAGE_SIZE;
  const empty = (error: string | null = null): QualityRecordingsPage => ({
    rows: [],
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize,
    error,
  });

  try {
    let allowedTeamIds: string[] | null = null;
    if (profile.role === "supervisor") {
      allowedTeamIds = await supervisorTeamIds(supabase, profile.id);
      if (allowedTeamIds.length === 0) return empty();
    }

    let leadIds: string[] | null = null;
    if (filters.rut) {
      const { data, error } = await supabase.rpc("search_leads_quick", { p_term: filters.rut });
      if (error) throw new Error(error.message);
      leadIds = ((data ?? []) as { id: string }[]).map((lead) => lead.id);
      if (leadIds.length === 0) return empty();
    }

    let query = supabase
      .from("call_recordings")
      .select(
        "id, call_id, lead_id, campaign_id, agent_id, started_at, ended_at, duration_seconds, codec, size_bytes, disconnect_party, queue_talk_seconds, status",
        { count: "exact" }
      )
      .neq("status", "deleted")
      .order("started_at", { ascending: false });

    // Se usa el snapshot team_id de la grabación, no el equipo actual del
    // ejecutivo: un traslado posterior no debe reescribir el alcance histórico.
    if (allowedTeamIds) query = query.in("team_id", allowedTeamIds);
    if (filters.agent) query = query.eq("agent_id", filters.agent);
    if (filters.campaign) query = query.eq("campaign_id", filters.campaign);
    if (leadIds) query = query.in("lead_id", leadIds);

    // El rango se resuelve en America/Santiago, igual que los reportes. Esto
    // evita cortar la jornada cuatro horas antes cuando Next corre en UTC.
    const range = resolveReportRange({ preset: "custom", from: filters.from, to: filters.to });
    query = query.gte("started_at", range.from.toISOString()).lte("started_at", range.to.toISOString());

    const desiredPage = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1);
    let offset = (desiredPage - 1) * pageSize;
    let result = await query.range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);

    const total = result.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(desiredPage, pageCount);

    // Si se pidió una página que dejó de existir (por ejemplo tras cambiar un
    // filtro), repetimos sólo la consulta de la última página válida.
    if (page !== desiredPage && total > 0) {
      offset = (page - 1) * pageSize;
      result = await query.range(offset, offset + pageSize - 1);
      if (result.error) throw new Error(result.error.message);
    }

    const recordings = (result.data ?? []) as RecordingRecord[];
    const leadIdSet = [...new Set(recordings.map((recording) => recording.lead_id))];
    const agentIdSet = [...new Set(recordings.map((recording) => recording.agent_id))];
    const campaignIdSet = [...new Set(recordings.map((recording) => recording.campaign_id))];
    const callIdSet = [...new Set(recordings.map((recording) => recording.call_id))];

    const [leadsResult, agentsResult, campaignsResult, callsResult, transcriptionsResult] = await Promise.all([
      leadIdSet.length
        ? relatedDataClient.from("leads").select("id, full_name, rut").in("id", leadIdSet)
        : Promise.resolve({ data: [], error: null }),
      agentIdSet.length
        ? relatedDataClient.from("profiles").select("id, full_name").in("id", agentIdSet)
        : Promise.resolve({ data: [], error: null }),
      campaignIdSet.length
        ? relatedDataClient.from("campaigns").select("id, name").in("id", campaignIdSet)
        : Promise.resolve({ data: [], error: null }),
      callIdSet.length
        ? relatedDataClient.from("calls").select("id, reason, outcome, ended_at, discarded_reason").in("id", callIdSet)
        : Promise.resolve({ data: [], error: null }),
      recordings.length
        ? supabase
            .from("call_transcriptions")
            .select("recording_id, status")
            .in("recording_id", recordings.map((recording) => recording.id))
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError =
      leadsResult.error ??
      agentsResult.error ??
      campaignsResult.error ??
      callsResult.error ??
      transcriptionsResult.error;
    if (relatedError) throw new Error(relatedError.message);

    const leads = new Map(
      (leadsResult.data ?? []).map((lead) => [lead.id as string, lead as { full_name: string; rut: string | null }])
    );
    const agents = new Map(
      (agentsResult.data ?? []).map((agent) => [agent.id as string, agent.full_name as string])
    );
    const campaigns = new Map(
      (campaignsResult.data ?? []).map((campaign) => [campaign.id as string, campaign.name as string])
    );
    const calls = new Map(
      (callsResult.data ?? []).map((call) => [
        call.id as string,
        call as { reason: string | null; outcome: string | null; ended_at: string | null; discarded_reason: string | null },
      ])
    );
    const transcriptions = new Map(
      (transcriptionsResult.data ?? []).map((transcription) => [
        transcription.recording_id as string,
        transcription.status as QualityTranscriptionStatus,
      ])
    );

    return {
      rows: recordings.map((recording) => {
        const lead = leads.get(recording.lead_id);
        const call = calls.get(recording.call_id);
        const durationSeconds =
          recording.duration_seconds === null ? null : Number(recording.duration_seconds);
        const queueTalkSeconds =
          recording.queue_talk_seconds === null ? null : Number(recording.queue_talk_seconds);
        return {
          id: recording.id,
          callId: recording.call_id,
          leadId: recording.lead_id,
          campaignId: recording.campaign_id,
          campaignName: campaigns.get(recording.campaign_id) ?? "Campaña no disponible",
          agentId: recording.agent_id,
          agentName: agents.get(recording.agent_id) ?? "Ejecutivo no disponible",
          typification: call?.reason ?? null,
          callEndedAt: call?.ended_at ?? null,
          callDiscardedReason: call?.discarded_reason ?? null,
          callOutcome: call?.outcome ?? null,
          disconnectParty: recording.disconnect_party,
          queueTalkSeconds,
          leadName: lead?.full_name ?? "Cliente no disponible",
          rut: lead?.rut ?? "Sin RUT",
          startedAt: recording.started_at,
          endedAt: recording.ended_at,
          durationSeconds,
          codec: recording.codec,
          sizeBytes: recording.size_bytes === null ? null : Number(recording.size_bytes),
          status: recording.status,
          transcriptionStatus: transcriptions.get(recording.id) ?? null,
          transcriptionEligibility: evaluateQualityTranscriptionEligibility({
            recordingStatus: recording.status,
            durationSeconds,
            queueTalkSeconds,
            outcome: call?.outcome ?? null,
          }),
        };
      }),
      total,
      page,
      pageCount,
      pageSize,
      error: null,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "No se pudieron consultar las grabaciones.");
  }
}
