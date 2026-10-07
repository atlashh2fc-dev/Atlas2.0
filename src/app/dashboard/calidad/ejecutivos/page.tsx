import Link from "next/link";
import { ClipboardCheck, Sigma, Target, TrendingDown, TrendingUp, Users } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadQualityCalls, loadQualityScope } from "@/lib/quality-scorecard.server";
import { agentCriterionMatrix, agentScorecard } from "@/lib/quality-scorecard";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Avatar, Callout, EmptyState, SectionCard, buttonClasses } from "@/components/ui";
import {
  formatScore,
  parseQualityFilters,
  QualityFilters,
  qualityQuery,
  scoreTone,
  type QualityFilterParams,
} from "@/components/quality/quality-filters";
import { AgentScorecardTable, type AgentScorecardRow } from "@/components/quality/agent-scorecard-table";
import { HeatCellView } from "@/components/quality/quality-charts";

export default async function CalidadEjecutivosPage({ searchParams }: { searchParams: Promise<QualityFilterParams> }) {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const state = parseQualityFilters(await searchParams);
  const supabase = await createClient();
  const admin = createAdminClient();
  const scope = await loadQualityScope(supabase, admin, profile);

  if (scope.pautas.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={ClipboardCheck}
          title="Todavía no hay una pauta de calidad vigente"
          action={<Link href="/dashboard/calidad/pautas" className={buttonClasses()}>Cargar pauta</Link>}
        />
      </SectionCard>
    );
  }

  const { rows, error } = await loadQualityCalls(supabase, admin, {
    from: state.range.from,
    to: state.range.to,
    campaignId: state.campaignId || undefined,
    agentId: state.agentId || undefined,
  });
  const objective = scope.objective;
  const scorecard = agentScorecard(rows, objective);
  const names = new Map(rows.map((row) => [row.agentId, row.agentName]));
  const tableRows: AgentScorecardRow[] = scorecard.rows.map((row) => ({
    ...row,
    agentName: names.get(row.agentId) ?? "Ejecutivo",
    objective,
    teamAverage: scorecard.teamAverage ?? 0,
    standardDeviation: scorecard.standardDeviation ?? 0,
    lci: scorecard.lci ?? 0,
    lcs: scorecard.lcs ?? 0,
    href: `/dashboard/calidad/evaluaciones?${qualityQuery({ ...state, agentId: row.agentId }, { estado: "todas" })}`,
  }));
  const belowObjective = scorecard.rows.filter((row) => !row.meetsObjective).length;
  const matrix = agentCriterionMatrix(rows);

  return (
    <div className="space-y-5">
      <QualityFilters state={state} campaigns={scope.campaigns} agents={scope.agents} storageKey="calidad-ejecutivos" />
      {state.range.notice && <Callout tone="warning">{state.range.notice}</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}

      <KpiStrip title="Equipo" meta="Límites de control = promedio de las notas finales ± 1 desviación estándar">
        <KpiStripItem
          label="Promedio del equipo"
          value={formatScore(scorecard.teamAverage)}
          icon={Users}
          tone={scoreTone(scorecard.teamAverage, objective)}
          detail={`Objetivo ${formatScore(objective)}`}
        />
        <KpiStripItem label="Desviación estándar" value={formatScore(scorecard.standardDeviation, 2)} icon={Sigma} />
        <KpiStripItem label="LCI" value={formatScore(scorecard.lci)} icon={TrendingDown} detail="Bajo esta nota, el ejecutivo sale de control" />
        <KpiStripItem label="LCS" value={formatScore(scorecard.lcs)} icon={TrendingUp} />
        <KpiStripItem
          label="Bajo objetivo"
          value={`${belowObjective} de ${scorecard.rows.length}`}
          icon={Target}
          tone={belowObjective > 0 ? "warn" : "default"}
        />
      </KpiStrip>

      <section aria-labelledby="calidad-ejecutivos-title" className="space-y-3">
        <div>
          <h2 id="calidad-ejecutivos-title" className="text-[15px] font-semibold tracking-tight text-foreground">Nota y cuartil por ejecutivo</h2>
          <p className="mt-1 text-xs text-muted-foreground">Exporta a Excel para el informe semanal. Abre un ejecutivo para ver y validar sus llamadas.</p>
        </div>
        <AgentScorecardTable rows={tableRows} />
      </section>

      <SectionCard
        title="Cumplimiento por atributo"
        description="Porcentaje de llamadas en que cada ejecutivo cumple el atributo sin observaciones. Más intenso = mejor."
      >
        {scorecard.rows.length === 0 || matrix.criteria.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Sin datos para el período" />
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left font-medium text-muted-foreground">Ejecutivo</th>
                  {matrix.criteria.map((criterion) => (
                    <th key={criterion.id} scope="col" className="max-w-24 px-1 py-2 text-center align-bottom text-[11px] font-medium leading-tight text-muted-foreground">
                      {criterion.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.agentId}>
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <Avatar name={row.agentName} size="xs" />
                        <span className="max-w-40 truncate text-foreground">{row.agentName}</span>
                      </span>
                    </th>
                    {matrix.criteria.map((criterion) => {
                      const cell = matrix.cell(row.agentId, criterion.id);
                      return (
                        <td key={criterion.id} className="min-w-14">
                          <HeatCellView compliance={cell.compliance} evaluated={cell.evaluated} label={`${row.agentName} · ${criterion.name}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
