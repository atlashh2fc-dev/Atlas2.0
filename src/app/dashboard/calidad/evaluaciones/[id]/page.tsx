import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { vigentePautaForCampaign, PAUTA_EVALUATION_COLUMNS } from "@/lib/quality-pipeline.server";
import { loadQualityCalls } from "@/lib/quality-scorecard.server";
import { pautaRubricKey, selectRubric, type PautaRubric, type PautaScale } from "@/lib/quality-pauta";
import { startOfDay } from "@/lib/report-range";
import {
  QualityReviewWorkspace,
  type ReviewEvaluation,
  type ReviewRecord,
} from "@/components/quality/quality-review-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EvaluationRow = {
  id: string;
  rubric_key: string;
  rubric_name: string;
  rubric_snapshot: { rubric?: PautaRubric; scale?: PautaScale; objective?: number } | null;
  status: "pending" | "processing" | "completed" | "failed";
  overall_score: number | string | null;
  verdict: ReviewEvaluation["verdict"];
  invalid_reason: ReviewEvaluation["invalidReason"];
  speaker_confidence: number | string | null;
  summary: string | null;
  criteria: ReviewEvaluation["criteria"];
  strengths: string[];
  improvements: string[];
  risk_flags: ReviewEvaluation["riskFlags"];
  completed_at: string | null;
};

/** Las últimas dos semanas, en días de Chile, para buscar la siguiente por validar. */
function lastTwoWeeks() {
  const now = new Date();
  return { from: startOfDay(new Date(now.getTime() - 13 * 86_400_000)), to: now };
}

export default async function CalidadEvaluacionPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  // La sesión decide si la grabación está en el alcance de quien mira.
  const supabase = await createClient();
  const { data: recording } = await supabase
    .from("call_recordings")
    .select("id, call_id, lead_id, campaign_id, agent_id, started_at, duration_seconds, status")
    .eq("id", id)
    .maybeSingle();
  if (!recording) notFound();

  const admin = createAdminClient();
  const [leadResult, agentResult, campaignResult, callResult, transcriptionResult, evaluationResult, reviewResult, pauta] = await Promise.all([
    admin.from("leads").select("full_name, rut").eq("id", recording.lead_id).maybeSingle(),
    recording.agent_id ? admin.from("profiles").select("full_name").eq("id", recording.agent_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("campaigns").select("name").eq("id", recording.campaign_id).maybeSingle(),
    recording.call_id ? admin.from("calls").select("reason, outcome").eq("id", recording.call_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("call_transcriptions").select("status, transcript_text, segments").eq("recording_id", id).maybeSingle(),
    supabase
      .from("call_quality_evaluations")
      .select(PAUTA_EVALUATION_COLUMNS)
      .eq("recording_id", id)
      .not("pauta_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("call_quality_reviews")
      .select("rubric_key, call_validity, criteria, overall_score, verdict, action, comment, reviewer_id, updated_at")
      .eq("recording_id", id)
      .maybeSingle(),
    vigentePautaForCampaign(admin, recording.campaign_id).catch(() => null),
  ]);

  const call = callResult.data as { reason: string | null; outcome: string | null } | null;
  const evaluationRow = evaluationResult.data as EvaluationRow | null;
  const reviewRow = reviewResult.data as (ReviewRecord & { reviewer_id: string | null }) | null;
  const reviewer = reviewRow?.reviewer_id
    ? ((await admin.from("profiles").select("full_name").eq("id", reviewRow.reviewer_id).maybeSingle()).data as { full_name: string } | null)
    : null;

  const evaluation: ReviewEvaluation | null = evaluationRow
    ? {
        status: evaluationRow.status,
        score: evaluationRow.overall_score === null ? null : Number(evaluationRow.overall_score),
        verdict: evaluationRow.verdict,
        invalidReason: evaluationRow.invalid_reason,
        speakerConfidence: evaluationRow.speaker_confidence === null ? null : Number(evaluationRow.speaker_confidence),
        summary: evaluationRow.summary,
        criteria: Array.isArray(evaluationRow.criteria) ? evaluationRow.criteria : [],
        strengths: Array.isArray(evaluationRow.strengths) ? evaluationRow.strengths : [],
        improvements: Array.isArray(evaluationRow.improvements) ? evaluationRow.improvements : [],
        riskFlags: Array.isArray(evaluationRow.risk_flags) ? evaluationRow.risk_flags : [],
        rubricKey: evaluationRow.rubric_key,
        rubricName: evaluationRow.rubric_snapshot?.rubric?.name ?? evaluationRow.rubric_name,
        completedAt: evaluationRow.completed_at,
      }
    : null;

  // Rúbricas posibles: la de la evaluación IA (snapshot) o las de la pauta vigente.
  const options: { key: string; rubric: PautaRubric }[] =
    evaluationRow?.status === "completed" && evaluationRow.rubric_snapshot?.rubric
      ? [{ key: evaluationRow.rubric_key, rubric: evaluationRow.rubric_snapshot.rubric }]
      : pauta
        ? pauta.rubrics.map((rubric) => ({ key: pautaRubricKey(pauta.key, rubric.key), rubric }))
        : [];
  const suggested = pauta ? selectRubric(pauta, call?.outcome ?? null) : null;
  const defaultRubricKey =
    reviewRow?.rubric_key && options.some((option) => option.key === reviewRow.rubric_key)
      ? reviewRow.rubric_key
      : options.length === 1
        ? options[0].key
        : suggested && pauta
          ? pautaRubricKey(pauta.key, suggested.key)
          : options[0]?.key ?? "";
  const scale = (evaluationRow?.status === "completed" ? evaluationRow.rubric_snapshot?.scale : null) ?? pauta?.scale ?? null;
  const objective = evaluationRow?.rubric_snapshot?.objective ?? pauta?.objective ?? 95;

  // Siguiente llamada por validar de las últimas dos semanas (para no volver a la lista).
  let nextHref: string | null = null;
  const queue = await loadQualityCalls(supabase, admin, lastTwoWeeks());
  const next = queue.rows.find((row) => row.source === "ia" && row.recordingId !== id);
  if (next) nextHref = `/dashboard/calidad/evaluaciones/${next.recordingId}`;

  const transcription = transcriptionResult.data as { status: string; transcript_text: string | null; segments: { start?: number; end?: number; text?: string }[] } | null;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/calidad/evaluaciones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft size={15} aria-hidden="true" />
        Evaluaciones
      </Link>
      <QualityReviewWorkspace
        // Cuando llega una evaluación IA nueva, el formulario parte desde ella.
        key={`${evaluation?.status ?? "sin"}-${evaluation?.completedAt ?? ""}-${transcription?.status ?? ""}`}
        recordingId={id}
        playable={recording.status === "ready"}
        call={{
          agentName: (agentResult.data as { full_name: string } | null)?.full_name ?? "Ejecutivo",
          leadName: (leadResult.data as { full_name: string } | null)?.full_name ?? "Cliente",
          rut: (leadResult.data as { rut: string | null } | null)?.rut ?? null,
          campaignName: (campaignResult.data as { name: string } | null)?.name ?? "Campaña",
          typification: call?.reason ?? null,
          startedAt: recording.started_at,
          durationSeconds: recording.duration_seconds === null ? null : Number(recording.duration_seconds),
        }}
        transcription={
          transcription
            ? {
                status: transcription.status,
                text: transcription.transcript_text,
                segments: Array.isArray(transcription.segments) ? transcription.segments : [],
              }
            : null
        }
        evaluation={evaluation}
        review={reviewRow ? { ...reviewRow, reviewerName: reviewer?.full_name ?? null } : null}
        rubricOptions={options}
        defaultRubricKey={defaultRubricKey}
        scale={scale}
        objective={objective}
        hasPauta={Boolean(pauta) || options.length > 0}
        canValidate={profile.role !== "agente"}
        nextHref={nextHref}
      />
    </div>
  );
}
