import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  ClipboardCheck,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Target,
} from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadQualityCalls, loadQualityScope } from "@/lib/quality-scorecard.server";
import { calibration, criterionGaps, dailyTrend, summarize } from "@/lib/quality-scorecard";
import { ACTION_LABEL, QUALITY_ACTIONS, VERDICT_LABEL, type QualityVerdict } from "@/lib/quality-pauta";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Badge, Callout, EmptyState, SectionCard, Table, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import {
  formatPercent,
  formatScore,
  parseQualityFilters,
  QualityFilters,
  qualityQuery,
  scoreTone,
  type QualityFilterParams,
} from "@/components/quality/quality-filters";
import { DailyScoreBars, OutcomeBar, OutcomeLegend } from "@/components/quality/quality-charts";

const VERDICT_ORDER: QualityVerdict[] = ["cumple", "parcial", "no_cumple", "no_evaluable"];
const VERDICT_BAR: Record<QualityVerdict, string> = {
  cumple: "bg-success",
  parcial: "bg-warning",
  no_cumple: "bg-danger",
  no_evaluable: "bg-muted-foreground/30",
};

export default async function CalidadResumenPage({ searchParams }: { searchParams: Promise<QualityFilterParams> }) {
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
          description="Carga la planilla de la pauta para que Atlas evalúe las llamadas y arme este tablero."
          action={<Link href="/dashboard/calidad/pautas" className={buttonClasses()}>Cargar pauta</Link>}
        />
      </SectionCard>
    );
  }

  const { rows, error, truncated } = await loadQualityCalls(supabase, admin, {
    from: state.range.from,
    to: state.range.to,
    campaignId: state.campaignId || undefined,
    agentId: state.agentId || undefined,
  });
  const objective = scope.objective;
  const summary = summarize(rows, objective);
  const gaps = criterionGaps(rows);
  const trend = dailyTrend(rows);
  const calib = calibration(rows);
  const pending = rows.filter((row) => row.source === "ia").length;
  const pauta = scope.pautas[0];
  const validatedShare = summary.evaluated ? (summary.validated / summary.evaluated) * 100 : 0;

  return (
    <div className="space-y-5">
      <QualityFilters state={state} campaigns={scope.campaigns} agents={scope.agents} storageKey="calidad-resumen" />

      {state.range.notice && <Callout tone="warning">{state.range.notice}</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
      {truncated && <Callout tone="warning">El período tiene más de 5.000 evaluaciones; acota el rango para ver cifras completas.</Callout>}

      <KpiStrip
        title="Calidad del período"
        meta={`${pauta.name} · v${pauta.version} · objetivo ${formatScore(objective)}`}
      >
        <KpiStripItem
          label="Nota promedio"
          value={summary.averageScore === null ? "—" : formatScore(summary.averageScore)}
          icon={Gauge}
          tone={scoreTone(summary.averageScore, objective)}
          progress={summary.averageScore ?? undefined}
          detail={summary.onTarget === null ? "Sin llamadas con nota" : `${formatPercent(summary.onTarget)} de las llamadas sobre el objetivo`}
          definition={{
            text: "Promedio ponderado de la pauta. Usa la nota validada por Calidad y, mientras no se valide, la de la IA.",
            formula: "Σ peso × (Cumple 1 · Con obs. 0,5 · No cumple 0 · No aplica 1)",
          }}
        />
        <KpiStripItem
          label="Llamadas evaluadas"
          value={summary.evaluated.toLocaleString("es-CL")}
          icon={ClipboardCheck}
          progress={validatedShare}
          detail={`${summary.validated.toLocaleString("es-CL")} validadas por Calidad · ${summary.invalid} no válidas`}
        />
        <KpiStripItem
          label="Sin error crítico (PEC)"
          value={formatPercent(summary.pec)}
          icon={ShieldCheck}
          tone={summary.pec === null ? "default" : summary.pec >= 90 ? "good" : summary.pec >= 75 ? "warn" : "danger"}
          definition={{ text: "Porcentaje de llamadas sin ningún atributo en «No cumple»." }}
        />
        <KpiStripItem
          label="Sin error no crítico (PENC)"
          value={formatPercent(summary.penc)}
          icon={ShieldAlert}
          tone={summary.penc === null ? "default" : summary.penc >= 80 ? "good" : "warn"}
          definition={{ text: "Porcentaje de llamadas sin ningún atributo en «Cumple con obs.»." }}
        />
        <KpiStripItem
          label="Coincidencia IA ↔ Calidad"
          value={formatPercent(summary.agreement)}
          icon={BrainCircuit}
          tone={summary.agreement === null ? "default" : summary.agreement >= 85 ? "good" : "warn"}
          detail={calib.compared ? `${calib.compared} atributos comparados` : "Aparece al validar llamadas"}
          definition={{ text: "En las llamadas validadas, porcentaje de atributos donde la analista confirmó lo que dijo la IA." }}
        />
      </KpiStrip>

      {pending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3.5 shadow-sm">
          <p className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">{pending.toLocaleString("es-CL")}</span> llamadas evaluadas por la IA esperan tu validación.
          </p>
          <Link href={`/dashboard/calidad/evaluaciones?${qualityQuery(state, { estado: "por_validar" })}`} className={buttonClasses()}>
            Validar evaluaciones
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SectionCard title="Nota por día" description="Promedio de las llamadas evaluadas cada día (hora de Chile).">
          <DailyScoreBars days={trend} objective={objective} />
        </SectionCard>

        <SectionCard title="Resultado de las llamadas" description="Veredicto según los errores de la pauta.">
          <div className="space-y-3 px-5 pb-5">
            <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted">
              {VERDICT_ORDER.map((verdict) =>
                summary.verdicts[verdict] ? (
                  <span
                    key={verdict}
                    className={VERDICT_BAR[verdict]}
                    style={{ width: `${(summary.verdicts[verdict] / Math.max(1, summary.evaluated)) * 100}%` }}
                    title={`${VERDICT_LABEL[verdict]}: ${summary.verdicts[verdict]}`}
                  />
                ) : null,
              )}
            </div>
            <ul className="divide-y divide-border/70 text-sm">
              {VERDICT_ORDER.map((verdict) => (
                <li key={verdict} className="flex items-center justify-between gap-3 py-2">
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <span className={`size-2.5 rounded-sm ${VERDICT_BAR[verdict]}`} aria-hidden="true" />
                    {VERDICT_LABEL[verdict]}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{summary.verdicts[verdict]}</span>
                    {summary.evaluated ? ` · ${formatPercent((summary.verdicts[verdict] / summary.evaluated) * 100)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Acciones definidas por Calidad</p>
              <ul className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {QUALITY_ACTIONS.filter((action) => action !== "sin_accion").map((action) => (
                  <li key={action} className="flex items-center justify-between rounded-lg bg-surface-muted/60 px-2.5 py-1.5">
                    <span className="text-muted-foreground">{ACTION_LABEL[action]}</span>
                    <span className="font-semibold tabular-nums text-foreground">{summary.actions[action]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Brechas por atributo"
        description="Ordenadas por los puntos de nota que se pierden en promedio: lo primero es lo que más conviene trabajar."
        actions={<OutcomeLegend />}
      >
        {gaps.length === 0 ? (
          <EmptyState icon={Target} title="Sin atributos evaluados en el período" />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Atributo</Th>
                <Th className="text-right">Peso</Th>
                <Th className="w-[34%]">Resultados</Th>
                <Th className="text-right">Cumple</Th>
                <Th className="text-right">Puntos perdidos</Th>
              </Tr>
            </Thead>
            <Tbody>
              {gaps.map((gap) => (
                <Tr key={`${gap.rubricName}-${gap.id}`}>
                  <Td>
                    <span className="block font-medium text-foreground">{gap.name}</span>
                    <span className="block text-xs text-muted-foreground">{gap.rubricName} · {gap.evaluated} llamadas</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatScore(gap.weight)}</Td>
                  <Td>
                    <OutcomeBar values={{ cumple: gap.cumple, parcial: gap.parcial, noCumple: gap.noCumple, noAplica: gap.noAplica }} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatPercent(gap.compliance)}</Td>
                  <Td className="text-right font-semibold tabular-nums text-foreground">{formatScore(gap.pointsLost, 2)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Calibración de la IA"
        description="En las llamadas validadas: dónde coincide la IA con Calidad y hacia dónde se equivoca."
      >
        {calib.rows.length === 0 ? (
          <EmptyState
            icon={BrainCircuit}
            title="Aún no hay llamadas validadas"
            description="Cada validación compara atributo por atributo tu criterio con el de la IA."
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Atributo</Th>
                <Th className="text-right">Comparados</Th>
                <Th className="text-right">Coincide</Th>
                <Th className="text-right">IA más severa</Th>
                <Th className="text-right">IA más blanda</Th>
              </Tr>
            </Thead>
            <Tbody>
              {calib.rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium text-foreground">{row.name}</Td>
                  <Td className="text-right tabular-nums">{row.compared}</Td>
                  <Td className="text-right">
                    <Badge tone={row.agreement >= 85 ? "success" : row.agreement >= 65 ? "warning" : "danger"}>{formatPercent(row.agreement)}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{row.aiStricter}</Td>
                  <Td className="text-right tabular-nums">{row.aiLenient}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
