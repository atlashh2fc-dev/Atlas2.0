import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";
import { vigentePautas } from "@/lib/quality-pipeline.server";
import type { AiCriterionStatus, QualityAction, QualityPauta, QualityVerdict } from "@/lib/quality-pauta";
import type { CallCriterion, QualityCall } from "@/lib/quality-scorecard";

export type Option = { id: string; name: string };

export type QualityScope = {
  organizationId: string | null;
  campaigns: Option[];
  agents: Option[];
  pautas: QualityPauta[];
  /** Campañas cubiertas por alguna pauta vigente. */
  pautaCampaignIds: string[];
  objective: number;
};

/**
 * Alcance de quien mira Calidad. Admin y Calidad: toda la empresa que está
 * mirando. Supervisor: sus equipos. Los nombres (campañas, ejecutivos) se leen
 * con la service role solo dentro de ese alcance, porque Calidad no tiene
 * lectura directa de perfiles ni campañas.
 */
export async function loadQualityScope(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  profile: Pick<Profile, "role">,
): Promise<QualityScope> {
  const { data: organizationId } = await supabase.rpc("current_org_id");
  const orgId = typeof organizationId === "string" ? organizationId : null;
  const pautas = await vigentePautas(supabase);

  let campaigns: Option[] = [];
  let agents: Option[] = [];
  if (profile.role === "supervisor") {
    const teamIds = await getSupervisedTeamIds(supabase);
    const [{ data: campaignRows }, { data: agentRows }] = await Promise.all([
      supabase.rpc("get_report_scope_campaigns"),
      teamIds.length
        ? supabase.from("profiles").select("id, full_name").eq("role", "agente").in("team_id", teamIds).order("full_name")
        : Promise.resolve({ data: [] }),
    ]);
    campaigns = ((campaignRows ?? []) as Option[]).map((row) => ({ id: row.id, name: row.name }));
    agents = ((agentRows ?? []) as { id: string; full_name: string }[]).map((row) => ({ id: row.id, name: row.full_name }));
  } else if (orgId) {
    const [{ data: campaignRows }, { data: agentRows }] = await Promise.all([
      admin.from("campaigns").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name"),
      admin.from("profiles").select("id, full_name").eq("organization_id", orgId).eq("role", "agente").order("full_name"),
    ]);
    campaigns = (campaignRows ?? []) as Option[];
    agents = ((agentRows ?? []) as { id: string; full_name: string }[]).map((row) => ({ id: row.id, name: row.full_name }));
  }

  return {
    organizationId: orgId,
    campaigns,
    agents,
    pautas,
    pautaCampaignIds: [...new Set(pautas.flatMap((pauta) => pauta.campaignIds))],
    objective: pautas[0]?.objective ?? 95,
  };
}

export type QualityCallRow = QualityCall & {
  agentName: string;
  campaignName: string;
  typification: string | null;
  durationSeconds: number | null;
  aiVerdict: QualityVerdict | null;
  riskCount: number;
  reviewerName: string | null;
};

type RecordingJoin = {
  agent_id: string | null;
  campaign_id: string;
  started_at: string;
  call_id: string | null;
  duration_seconds: number | string | null;
};

type EvaluationRecord = {
  id: string;
  recording_id: string;
  rubric_key: string;
  rubric_name: string;
  rubric_snapshot: { rubric?: { name?: string } } | null;
  overall_score: number | string | null;
  verdict: QualityVerdict;
  critical_errors: number | null;
  non_critical_errors: number | null;
  criteria: { id: string; name: string; weight?: number; maxScore?: number; status: AiCriterionStatus }[];
  risk_flags: unknown[];
  updated_at: string;
  call_recordings: RecordingJoin | RecordingJoin[];
};

type ReviewRecord = {
  recording_id: string;
  evaluation_id: string | null;
  rubric_key: string;
  rubric_snapshot: { rubric?: { name?: string } } | null;
  reviewer_id: string | null;
  agent_id: string | null;
  campaign_id: string;
  call_started_at: string;
  overall_score: number | string | null;
  verdict: QualityVerdict;
  critical_errors: number;
  non_critical_errors: number;
  criteria: { id: string; name: string; weight: number; status: AiCriterionStatus }[];
  ai_score: number | string | null;
  ai_agreement: number | string | null;
  action: QualityAction;
};

const MAX_ROWS = 5000;

function asNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toCriteria(list: EvaluationRecord["criteria"] | ReviewRecord["criteria"] | null | undefined): CallCriterion[] {
  return (Array.isArray(list) ? list : []).map((criterion) => ({
    id: criterion.id,
    name: criterion.name,
    weight: Number((criterion as { weight?: number }).weight ?? (criterion as { maxScore?: number }).maxScore ?? 0),
    status: criterion.status,
  }));
}

/**
 * Llamadas evaluadas con pauta en el rango (por fecha de la llamada), con la
 * nota oficial ya resuelta. La lectura va con la sesión de quien mira: RLS
 * acota a su empresa o a sus equipos.
 */
export async function loadQualityCalls(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  filters: { from: Date; to: Date; campaignId?: string; agentId?: string },
): Promise<{ rows: QualityCallRow[]; error: string | null; truncated: boolean }> {
  const fromIso = filters.from.toISOString();
  const toIso = filters.to.toISOString();

  let evaluationQuery = supabase
    .from("call_quality_evaluations")
    .select(
      "id, recording_id, rubric_key, rubric_name, rubric_snapshot, overall_score, verdict, critical_errors, non_critical_errors, criteria, risk_flags, updated_at, call_recordings!inner(agent_id, campaign_id, started_at, call_id, duration_seconds)",
    )
    .not("pauta_id", "is", null)
    .eq("status", "completed")
    .gte("call_recordings.started_at", fromIso)
    .lte("call_recordings.started_at", toIso)
    .order("updated_at", { ascending: true })
    .limit(MAX_ROWS);
  if (filters.campaignId) evaluationQuery = evaluationQuery.eq("call_recordings.campaign_id", filters.campaignId);
  if (filters.agentId) evaluationQuery = evaluationQuery.eq("call_recordings.agent_id", filters.agentId);

  let reviewQuery = supabase
    .from("call_quality_reviews")
    .select(
      "recording_id, evaluation_id, rubric_key, rubric_snapshot, reviewer_id, agent_id, campaign_id, call_started_at, overall_score, verdict, critical_errors, non_critical_errors, criteria, ai_score, ai_agreement, action",
    )
    .gte("call_started_at", fromIso)
    .lte("call_started_at", toIso)
    .limit(MAX_ROWS);
  if (filters.campaignId) reviewQuery = reviewQuery.eq("campaign_id", filters.campaignId);
  if (filters.agentId) reviewQuery = reviewQuery.eq("agent_id", filters.agentId);

  const [evaluationResult, reviewResult] = await Promise.all([evaluationQuery, reviewQuery]);
  if (evaluationResult.error || reviewResult.error) {
    return { rows: [], error: "No se pudieron leer las evaluaciones de calidad.", truncated: false };
  }

  const evaluations = new Map<string, EvaluationRecord>();
  for (const row of (evaluationResult.data ?? []) as unknown as EvaluationRecord[]) evaluations.set(row.recording_id, row);
  const reviews = new Map<string, ReviewRecord>();
  for (const row of (reviewResult.data ?? []) as unknown as ReviewRecord[]) reviews.set(row.recording_id, row);

  const recordingIds = [...new Set([...evaluations.keys(), ...reviews.keys()])];
  const recordingInfo = new Map<string, RecordingJoin>();
  for (const [recordingId, evaluation] of evaluations) {
    const join = Array.isArray(evaluation.call_recordings) ? evaluation.call_recordings[0] : evaluation.call_recordings;
    if (join) recordingInfo.set(recordingId, join);
  }
  const missing = recordingIds.filter((id) => !recordingInfo.has(id));
  if (missing.length) {
    const { data } = await supabase
      .from("call_recordings")
      .select("id, agent_id, campaign_id, started_at, call_id, duration_seconds")
      .in("id", missing);
    for (const row of (data ?? []) as (RecordingJoin & { id: string })[]) recordingInfo.set(row.id, row);
  }

  const agentIds = new Set<string>();
  const campaignIds = new Set<string>();
  const callIds = new Set<string>();
  for (const info of recordingInfo.values()) {
    if (info.agent_id) agentIds.add(info.agent_id);
    campaignIds.add(info.campaign_id);
    if (info.call_id) callIds.add(info.call_id);
  }
  for (const review of reviews.values()) if (review.reviewer_id) agentIds.add(review.reviewer_id);

  const [profilesResult, campaignsResult, callsResult] = await Promise.all([
    agentIds.size ? admin.from("profiles").select("id, full_name").in("id", [...agentIds]) : Promise.resolve({ data: [] }),
    campaignIds.size ? admin.from("campaigns").select("id, name").in("id", [...campaignIds]) : Promise.resolve({ data: [] }),
    callIds.size ? admin.from("calls").select("id, reason").in("id", [...callIds]) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((profilesResult.data ?? []) as { id: string; full_name: string }[]).map((row) => [row.id, row.full_name]));
  const campaigns = new Map(((campaignsResult.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const reasons = new Map(((callsResult.data ?? []) as { id: string; reason: string | null }[]).map((row) => [row.id, row.reason]));

  const rows: QualityCallRow[] = recordingIds.flatMap((recordingId): QualityCallRow[] => {
    const info = recordingInfo.get(recordingId);
    if (!info) return [];
    const evaluation = evaluations.get(recordingId) ?? null;
    const review = reviews.get(recordingId) ?? null;
    const aiCriteria = evaluation ? toCriteria(evaluation.criteria) : null;
    const aiScore = evaluation ? asNumber(evaluation.overall_score) : null;
    const rubricName =
      review?.rubric_snapshot?.rubric?.name ?? evaluation?.rubric_snapshot?.rubric?.name ?? evaluation?.rubric_name ?? "Pauta";
    const base = {
      recordingId,
      agentId: info.agent_id,
      campaignId: info.campaign_id,
      startedAt: info.started_at,
      rubricName,
      aiCriteria,
      aiScore,
      agentName: info.agent_id ? names.get(info.agent_id) ?? "Ejecutivo" : "Sin ejecutivo",
      campaignName: campaigns.get(info.campaign_id) ?? "Campaña",
      typification: info.call_id ? reasons.get(info.call_id) ?? null : null,
      durationSeconds: asNumber(info.duration_seconds),
      aiVerdict: evaluation?.verdict ?? null,
      riskCount: Array.isArray(evaluation?.risk_flags) ? evaluation.risk_flags.length : 0,
    };
    if (review) {
      return [{
        ...base,
        rubricKey: review.rubric_key,
        source: "validada" as const,
        score: asNumber(review.overall_score),
        verdict: review.verdict,
        criticalErrors: review.critical_errors,
        nonCriticalErrors: review.non_critical_errors,
        criteria: toCriteria(review.criteria),
        aiAgreement: asNumber(review.ai_agreement),
        action: review.action,
        reviewerName: review.reviewer_id ? names.get(review.reviewer_id) ?? null : null,
      }];
    }
    if (!evaluation) return [];
    return [{
      ...base,
      rubricKey: evaluation.rubric_key,
      source: "ia" as const,
      score: aiScore,
      verdict: evaluation.verdict,
      criticalErrors: evaluation.critical_errors ?? 0,
      nonCriticalErrors: evaluation.non_critical_errors ?? 0,
      criteria: aiCriteria ?? [],
      aiAgreement: null,
      action: null,
      reviewerName: null,
    }];
  });

  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const truncated = (evaluationResult.data?.length ?? 0) >= MAX_ROWS || (reviewResult.data?.length ?? 0) >= MAX_ROWS;
  return { rows, error: null, truncated };
}
