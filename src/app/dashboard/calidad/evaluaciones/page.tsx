import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadQualityCalls, loadQualityScope } from "@/lib/quality-scorecard.server";
import { Callout, SegmentTabs } from "@/components/ui";
import {
  parseQualityFilters,
  QualityFilters,
  qualityQuery,
  type QualityFilterParams,
} from "@/components/quality/quality-filters";
import { QualityEvaluationsTable, type EvaluationListRow } from "@/components/quality/quality-evaluations-table";

const VIEWS = {
  por_validar: { label: "Por validar", empty: "No quedan llamadas por validar en este período" },
  validadas: { label: "Validadas", empty: "Aún no hay llamadas validadas en este período" },
  no_validas: { label: "No válidas", empty: "No hay llamadas no válidas en este período" },
  todas: { label: "Todas", empty: "No hay llamadas evaluadas en este período" },
} as const;
type View = keyof typeof VIEWS;

export default async function CalidadEvaluacionesPage({ searchParams }: { searchParams: Promise<QualityFilterParams> }) {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const params = await searchParams;
  const state = parseQualityFilters(params);
  const view: View = params.estado && params.estado in VIEWS ? (params.estado as View) : "por_validar";
  const supabase = await createClient();
  const admin = createAdminClient();
  const [scope, calls] = await Promise.all([
    loadQualityScope(supabase, admin, profile),
    loadQualityCalls(supabase, admin, {
      from: state.range.from,
      to: state.range.to,
      campaignId: state.campaignId || undefined,
      agentId: state.agentId || undefined,
    }),
  ]);

  const rows: EvaluationListRow[] = calls.rows.map((row) => ({
    recordingId: row.recordingId,
    startedAt: row.startedAt,
    agentName: row.agentName,
    campaignName: row.campaignName,
    rubricName: row.rubricName,
    typification: row.typification,
    durationSeconds: row.durationSeconds,
    aiScore: row.aiScore,
    aiVerdict: row.aiVerdict,
    score: row.score,
    verdict: row.verdict,
    source: row.source,
    reviewerName: row.reviewerName,
    riskCount: row.riskCount,
    criticalErrors: row.criticalErrors,
    nonCriticalErrors: row.nonCriticalErrors,
  }));
  const counts: Record<View, number> = {
    por_validar: rows.filter((row) => row.source === "ia").length,
    validadas: rows.filter((row) => row.source === "validada").length,
    no_validas: rows.filter((row) => row.verdict === "no_evaluable").length,
    todas: rows.length,
  };
  const visible = rows.filter((row) =>
    view === "por_validar" ? row.source === "ia" : view === "validadas" ? row.source === "validada" : view === "no_validas" ? row.verdict === "no_evaluable" : true,
  );

  return (
    <div className="space-y-5">
      <QualityFilters
        state={state}
        campaigns={scope.campaigns}
        agents={scope.agents}
        storageKey="calidad-evaluaciones"
        hidden={{ estado: view }}
      />
      {state.range.notice && <Callout tone="warning">{state.range.notice}</Callout>}
      {calls.error && <Callout tone="danger">{calls.error}</Callout>}

      <section aria-label="Evaluaciones de calidad" className="space-y-0">
        <div className="border-b border-border">
          <SegmentTabs
            label="Estado de la evaluación"
            activeId={view}
            tabs={(Object.keys(VIEWS) as View[]).map((id) => ({
              id,
              label: VIEWS[id].label,
              count: counts[id],
              tone: id === "por_validar" && counts[id] > 0 ? "warning" : undefined,
              href: `/dashboard/calidad/evaluaciones?${qualityQuery(state, { estado: id })}`,
            }))}
          />
        </div>
        <div className="pt-3">
          <QualityEvaluationsTable rows={visible} emptyTitle={VIEWS[view].empty} />
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Atlas evalúa solo una muestra diaria por ejecutivo según la pauta. Para evaluar otra llamada, búscala en Grabaciones y usa «Evaluar».
      </p>
    </div>
  );
}
