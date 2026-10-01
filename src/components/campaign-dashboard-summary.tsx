"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarClock,
  Clock,
  Coins,
  Headset,
  Network,
  PhoneCall,
  Trophy,
  TrendingUp,
} from "lucide-react";
import {
  CHART_AXIS_TICK,
  CHART_COLOR,
  CHART_CURSOR,
  CHART_GRID,
  chartGradients,
  gradientUrl,
  useChartId,
} from "@/components/chart-theme";
import { Avatar, Badge, EmptyState, SectionCard } from "@/components/ui";
import { ChartLegend, ChartTooltip, DeltaChip, KpiStrip, KpiStripItem, Leaderboard } from "@/components/report-kit";
import type {
  CampaignDashboardSummary as CampaignDashboardSummaryData,
  CampaignDashboardSummaryMetric,
  SecretariaVirtualChannelFunnelRow,
} from "@/lib/types";
import { CALL_REASONS } from "@/lib/call-typification";
import Link from "next/link";
import { REPORT_TIME_ZONE } from "@/lib/report-range";
import {
  channelSegmentHref,
  channelSlug,
  type ChannelSlug,
  type ChannelStage,
} from "@/lib/channel-segment";
import { TipificationBreakdown } from "@/components/tipification-breakdown";
import {
  groupTipificationsByResult,
  type TipificationRow,
} from "@/lib/tipification-breakdown";
import {
  funnelStageLabel,
  getCampaignVocabulary,
  type CampaignVertical,
} from "@/lib/campaign-vertical";

export type ContactabilityHour = {
  hora: number;
  label: string;
  gestiones: number;
  contactos: number;
  ventas: number;
  /** Null cuando no hubo gestiones: no es 0 %, es ausencia de dato. */
  contactabilidad: number | null;
};

interface Props {
  summary: CampaignDashboardSummaryData;
  hourly: ContactabilityHour[];
  /** Vocabulario del tablero: una cartera no cierra ventas, recupera deuda. */
  vertical?: CampaignVertical;
  showFunnelOrigins?: boolean;
  channelFunnel?: SecretariaVirtualChannelFunnelRow[];
  /**
   * Tipificaciones con el estado y el desenlace que dejó grabado el cierre.
   * Cuando llegan, mandan sobre `summary.reasons`, que sólo trae el motivo:
   * son las que permiten clasificar a una campaña con workflow propio. Opcional
   * para que el panel siga funcionando donde todavía no se pasan.
   */
  tipificationRows?: TipificationRow[];
}

const REASON_LABEL = new Map(CALL_REASONS.map((r) => [r.value, r.label]));
const AGENDA_ASSIGNEE = "emily";

/**
 * Etiqueta legible de una tipificación. El catálogo comercial cubre los cierres
 * de venta; los de una cartera vienen del workflow de la campaña, así que se
 * formatean en vez de mostrarse en mayúsculas como los guarda la base.
 */
function reasonLabel(value: string): string {
  const known = REASON_LABEL.get(value);
  if (known) return known;
  const text = value.trim();
  if (!text) return "Sin tipificar";
  const lower = text.toLocaleLowerCase("es");
  return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

/** El período pertenece a la operación, no al huso de quien mira el reporte. */
function formatOperationDate(value: string): string {
  return new Date(value).toLocaleDateString("es-CL", { timeZone: REPORT_TIME_ZONE });
}

/**
 * Contactabilidad por franja horaria.
 *
 * Ocupa el lugar del "Mix de productos comerciales", que salía siempre vacío
 * porque se alimentaba de un campo que nadie carga. Es la lectura que en
 * outbound decide la programación del día: en qué horas contesta la gente.
 */
function ContactabilityByHour({ data, className }: { data: ContactabilityHour[]; className?: string }) {
  const chartId = useChartId("contactabilidad-hora");
  // Se recorta al tramo con actividad. Mostrar de 00:00 a 23:00 dejaría el
  // gráfico casi todo vacío y aplastaría las horas que importan.
  const active = data.filter((row) => row.gestiones > 0);
  const first = data.findIndex((row) => row.gestiones > 0);
  const last = data.length - 1 - [...data].reverse().findIndex((row) => row.gestiones > 0);
  const window = first === -1 ? [] : data.slice(first, last + 1);

  const best = active.reduce<ContactabilityHour | null>((top, row) => {
    // Se exige un mínimo de gestiones: una hora con 1 llamada contestada da
    // 100 % y no dice nada de cuándo conviene marcar.
    if (row.gestiones < 5) return top;
    if (!top || (row.contactabilidad ?? 0) > (top.contactabilidad ?? 0)) return row;
    return top;
  }, null);

  const totalGestiones = window.reduce((sum, row) => sum + row.gestiones, 0);
  const totalContactos = window.reduce((sum, row) => sum + row.contactos, 0);

  return (
    <SectionCard
      title="Contactabilidad por hora"
      className={className}
      actions={
        best && (
          <Badge tone="success" className="shrink-0">
            Mejor franja: <span className="font-semibold">{best.label}</span> ·{" "}
            {fmtPct((best.contactabilidad ?? 0) / 100)}
          </Badge>
        )
      }
    >
      <div className="px-5 pb-5">
      {window.length === 0 ? (
        <EmptyState icon={Clock} title="Sin gestiones cerradas en el período." />
      ) : (
        <>
        <ChartLegend
          items={[
            { label: "Gestiones", color: "color-mix(in srgb, var(--tone-slate) 55%, transparent)", value: fmtInt(totalGestiones) },
            { label: "Contactos", color: CHART_COLOR.primary, value: fmtInt(totalContactos) },
            { label: "% de contacto", color: CHART_COLOR.green },
          ]}
        />
        <div className="mt-4">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={window} barGap={2} margin={{ top: 4, right: 0, bottom: 0, left: -12 }}>
            {chartGradients(chartId, ["slate", "primary", "green"])}
            <CartesianGrid {...CHART_GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis yAxisId="left" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(value) => fmtInt(Number(value))} />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              unit="%"
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={CHART_CURSOR}
              content={
                <ChartTooltip
                  names={{ gestiones: "Gestiones", contactos: "Contactos", contactabilidad: "% de contacto" }}
                  formatValue={(value, key) => (key === "contactabilidad" ? `${value.toFixed(1)}%` : fmtInt(value))}
                />
              }
            />
            <Bar yAxisId="left" dataKey="gestiones" fill={gradientUrl(chartId, "slate")} fillOpacity={0.45} radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar yAxisId="left" dataKey="contactos" radius={[4, 4, 0, 0]} maxBarSize={20}>
              {/* La mejor franja va en verde: es la respuesta que busca quien mira. */}
              {window.map((row) => (
                <Cell key={row.hora} fill={gradientUrl(chartId, best && row.hora === best.hora ? "green" : "primary")} />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="contactabilidad"
              stroke={CHART_COLOR.green}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        </div>
        </>
      )}
      </div>
    </SectionCard>
  );
}

/**
 * Embudo de gestión.
 *
 * Reemplaza al `FunnelChart` de recharts, que dibuja cada etapa proporcional a
 * su valor: con una base de 68.815 registros y 70 gestiones, las cuatro etapas
 * siguientes medían menos de un píxel y el gráfico se veía vacío. Acá la barra
 * conserva la proporción pero nunca baja de un mínimo visible, y el dato que
 * importa —cuánto se conserva de una etapa a la siguiente— va escrito.
 */
function FunnelStages({
  stages,
  showOrigins = false,
}: {
  stages: CampaignDashboardSummaryData["funnel"];
  showOrigins?: boolean;
}) {
  const base = stages[0]?.value ?? 0;

  return (
    <ol>
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].value : null;
        const shareOfBase = base > 0 ? stage.value / base : 0;
        const stepConversion = previous && previous > 0 ? stage.value / previous : null;
        // Sin el mínimo, cualquier etapa por debajo del 1% de la base
        // desaparece y no se distingue de un cero.
        const width = stage.value > 0 ? Math.max(shareOfBase * 100, 1.5) : 0;
        const last = index === stages.length - 1;
        const color = last ? "var(--success)" : "var(--primary)";

        return (
          <li key={stage.name}>
            {stepConversion !== null && (
              /* Lo que importa de un embudo: cuánto pasa de una etapa a la siguiente. */
              <div className="flex items-center gap-2 py-1.5 pl-3 text-[11px] text-muted-foreground">
                <span aria-hidden="true" className="h-4 w-px bg-border-strong" />
                <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-semibold tabular-nums text-foreground">
                  {fmtPct(stepConversion)}
                </span>
                pasa a {stage.name.toLowerCase()}
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface-raised px-3.5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <span
                    aria-hidden="true"
                    className="flex size-5 items-center justify-center rounded-md text-[10px] font-semibold"
                    style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
                  >
                    {index + 1}
                  </span>
                  {stage.name}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className={`text-lg font-semibold leading-none tracking-tight tabular-nums ${last ? "text-success" : "text-foreground"}`}>
                    {fmtInt(stage.value)}
                  </span>
                  {index > 0 && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">{fmtPct(shareOfBase)} de la base</span>
                  )}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 50%, transparent), ${color})` }}
                  role="presentation"
                />
              </div>
              {showOrigins && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-medium">Origen:</span>
                  {(stage.origins ?? []).length === 0 ? (
                    <span>Sin desglose disponible</span>
                  ) : (
                    stage.origins?.map((origin) => (
                      <Badge key={origin.name} tone="neutral">
                        {origin.name}: <span className="font-semibold text-foreground">{fmtInt(origin.value)}</span>
                        {stage.value > 0 && ` · ${fmtPct(origin.value / stage.value)}`}
                      </Badge>
                    ))
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function metricPct(metric: CampaignDashboardSummaryMetric): number | null {
  if (metric.previous === 0) return metric.current === 0 ? 0 : null;
  return (metric.current - metric.previous) / metric.previous;
}

function Delta({ metric, invert = false }: { metric: CampaignDashboardSummaryMetric; invert?: boolean }) {
  return <DeltaChip change={metricPct(metric)} invert={invert} />;
}

/** Suma corrida: los cierres diarios son pocos y sueltos; acumulados muestran el ritmo. */
function cumulative(values: number[]): number[] {
  let total = 0;
  return values.map((value) => (total += value));
}

function ratio(current: number, total: number): number {
  return total > 0 ? current / total : 0;
}

/**
 * Cada número abre Registros con exactamente los leads que cuenta. Un cero no
 * lleva a ninguna parte: sería abrir una lista vacía.
 */
function ChannelFunnelCell({
  value,
  channel,
  stage,
  range,
  className,
}: {
  value: number;
  channel: ChannelSlug | null;
  stage: ChannelStage;
  range: { from: string; to: string };
  className: string;
}) {
  if (value <= 0) return <td className={className}>{fmtInt(value)}</td>;
  return (
    <td className={className}>
      <Link
        href={channelSegmentHref({ channel, stage, from: range.from, to: range.to })}
        className="rounded underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        title="Ver estos registros"
      >
        {fmtInt(value)}
      </Link>
    </td>
  );
}

function ChannelFunnelTable({
  rows,
  range,
}: {
  rows: SecretariaVirtualChannelFunnelRow[];
  range: { from: string; to: string };
}) {
  const totals = rows.reduce(
    (sum, row) => ({
      base: sum.base + row.base,
      contacted: sum.contacted + row.contacted,
      interested: sum.interested + row.interested,
      sales: sum.sales + row.sales,
    }),
    { base: 0, contacted: 0, interested: 0, sales: 0 }
  );
  const rowCell = "py-2.5 text-right tabular-nums text-muted-foreground";
  const totalCell = "pt-2.5 text-right tabular-nums";

  return (
    <SectionCard
      title="Resultado por canal de origen"
      icon={Network}
      tone="teal"
      description={
        <>
          Atribuye cada lead a su canal de entrada original; una conversación posterior por WhatsApp no cambia su origen.
          Toca un número para ver esos registros.
        </>
      }
    >
      <div className="overflow-x-auto px-5 pt-2">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="h-10 font-medium">Canal</th>
              <th className="py-2 text-right font-semibold">Base</th>
              <th className="py-2 text-right font-semibold">Contactados</th>
              <th className="py-2 text-right font-semibold">Interesados</th>
              <th className="py-2 text-right font-semibold">Ventas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const channel = channelSlug(row.channel);
              return (
                <tr key={row.channel}>
                  <td className="py-2.5 font-medium text-foreground">{row.channel}</td>
                  <ChannelFunnelCell value={row.base} channel={channel} stage="base" range={range} className={rowCell} />
                  <ChannelFunnelCell value={row.contacted} channel={channel} stage="contactados" range={range} className={rowCell} />
                  <ChannelFunnelCell value={row.interested} channel={channel} stage="interesados" range={range} className={rowCell} />
                  <ChannelFunnelCell
                    value={row.sales}
                    channel={channel}
                    stage="ventas"
                    range={range}
                    className="py-2.5 text-right font-semibold tabular-nums text-success"
                  />
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border font-semibold text-foreground">
            <tr>
              <td className="pt-2.5">Total</td>
              <ChannelFunnelCell value={totals.base} channel={null} stage="base" range={range} className={totalCell} />
              <ChannelFunnelCell value={totals.contacted} channel={null} stage="contactados" range={range} className={totalCell} />
              <ChannelFunnelCell value={totals.interested} channel={null} stage="interesados" range={range} className={totalCell} />
              <ChannelFunnelCell value={totals.sales} channel={null} stage="ventas" range={range} className={totalCell} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 pb-5 pt-4 text-xs text-muted-foreground">
        Contactado: conversación efectiva. Interesado: seguimiento, derivación o agenda. Venta: venta en validación registrada.
      </p>
    </SectionCard>
  );
}

function isVisibleAgendaItem(item: CampaignDashboardSummaryData["agenda"][number]): boolean {
  const assigneeTokens = item.agent_name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .trim()
    .split(/\s+/);

  return !item.overdue && assigneeTokens.includes(AGENDA_ASSIGNEE);
}

export function CampaignDashboardSummary({
  summary,
  hourly,
  vertical = "ventas",
  showFunnelOrigins = false,
  channelFunnel,
  tipificationRows,
}: Props) {
  const vocabulary = getCampaignVocabulary(vertical);
  const evolutionChartId = useChartId("evolucion");
  const kpis = summary.kpis;
  // Los vencidos y los compromisos de otros ejecutivos siguen en la base y en
  // su trazabilidad; sólo se ocultan en este panel de campañas.
  const visibleAgenda = summary.agenda.filter(isVisibleAgendaItem);
  const contactabilidad = {
    current: ratio(kpis.contactadas.current, kpis.gestionadas.current),
    previous: ratio(kpis.contactadas.previous, kpis.gestionadas.previous),
  };
  const tasaConversion = {
    current: ratio(kpis.ventas.current, kpis.contactadas.current),
    previous: ratio(kpis.ventas.previous, kpis.contactadas.previous),
  };
  const tipifications = groupTipificationsByResult(tipificationRows ?? summary.reasons);
  const funnel = summary.funnel.map((stage) => ({
    ...stage,
    name: funnelStageLabel(vocabulary, stage.name),
  }));

  return (
    <div className="space-y-6">
      {/* Con la zona del navegador, quien mire desde otro huso vería un día
          distinto al del reporte. El período es el de la operación. */}
      <KpiStrip
        title="Resumen del período"
        meta={
          <>
            {formatOperationDate(summary.range.from)} → {formatOperationDate(summary.range.to)}
          </>
        }
      >
        <KpiStripItem
          label={vocabulary.kpi.gestiones}
          icon={Headset}
          value={fmtInt(kpis.gestionadas.current)}
          delta={<Delta metric={kpis.gestionadas} />}
          trend={summary.time_series.map((point) => point.gestiones)}
        />
        <KpiStripItem
          label={vocabulary.kpi.contactabilidad}
          icon={PhoneCall}
          value={fmtPct(contactabilidad.current)}
          delta={<Delta metric={contactabilidad} />}
          detail={`${fmtInt(kpis.contactadas.current)} contactadas`}
          progress={contactabilidad.current * 100}
        />
        <KpiStripItem
          label={vocabulary.kpi.cierre}
          icon={Trophy}
          tone="good"
          value={fmtInt(kpis.ventas.current)}
          delta={<Delta metric={kpis.ventas} />}
          detail="Curva: acumulado del período"
          trend={cumulative(summary.time_series.map((point) => point.ventas))}
        />
        <KpiStripItem
          label={vocabulary.kpi.conversion}
          icon={TrendingUp}
          value={fmtPct(tasaConversion.current)}
          delta={<Delta metric={tasaConversion} />}
          detail="Sobre lo contactado"
          progress={tasaConversion.current * 100}
          tone="good"
        />
        <KpiStripItem
          label={vocabulary.kpi.monto}
          icon={Coins}
          value={`${Number(kpis.uf_total.current).toLocaleString("es-CL", { maximumFractionDigits: 1 })} UF`}
          delta={<Delta metric={kpis.uf_total} />}
        />
      </KpiStrip>

      {channelFunnel && channelFunnel.length > 0 && <ChannelFunnelTable rows={channelFunnel} range={summary.range} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={vertical === "cobranza" ? "Embudo de recuperación" : "Embudo de gestión"}
          description={showFunnelOrigins ? "Cada etapa se desglosa por la procedencia registrada del lead." : "Cuánto se conserva de una etapa a la siguiente."}
        >
          <div className="px-5 pb-5">
            <FunnelStages stages={funnel} showOrigins={showFunnelOrigins} />
          </div>
        </SectionCard>

        <SectionCard title={vocabulary.evolucionTitle} description="Gestiones del día (área) y cierres (barras, eje derecho).">
          <div className="px-5 pb-5">
          <ChartLegend
            items={[
              { label: vocabulary.kpi.gestiones, color: CHART_COLOR.primary, value: fmtInt(summary.time_series.reduce((sum, point) => sum + point.gestiones, 0)) },
              { label: vocabulary.kpi.cierre, color: CHART_COLOR.green, value: fmtInt(summary.time_series.reduce((sum, point) => sum + point.ventas, 0)) },
            ]}
          />
          <div className="mt-4">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={summary.time_series} margin={{ top: 4, right: 0, bottom: 0, left: -12 }}>
              {chartGradients(evolutionChartId, ["primary"], "area")}
              <CartesianGrid {...CHART_GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis yAxisId="left" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(value) => fmtInt(Number(value))} />
              {/* Los cierres son dos órdenes de magnitud menores: en el mismo eje
                  quedaban como una raya pegada al cero. */}
              <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                content={<ChartTooltip names={{ gestiones: vocabulary.kpi.gestiones, ventas: vocabulary.kpi.cierre }} />}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="gestiones"
                stroke={CHART_COLOR.primary}
                fill={gradientUrl(evolutionChartId, "primary")}
                strokeWidth={2.25}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              />
              {/* Cierres en barras: son pocos por día (0, 1, 2) y como línea
                  quedaban en zigzag. */}
              <Bar yAxisId="right" dataKey="ventas" fill={CHART_COLOR.green} radius={[3, 3, 0, 0]} maxBarSize={8} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
          </div>
        </SectionCard>

        <ContactabilityByHour data={hourly} className="lg:col-span-2" />
      </div>

      {/* A ancho completo: es el bloque con más contenido del tablero y en media
          columna obligaba a una lista vertical de veinte filas contra un vacío
          a la derecha. Acá los resultados caben lado a lado. */}
      <TipificationBreakdown breakdown={tipifications} title={vocabulary.motivosTitle} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={vocabulary.agendaTitle} description={`${fmtInt(visibleAgenda.length)} compromisos por delante.`}>
          <div className="max-h-96 overflow-y-auto border-t border-border">
            {visibleAgenda.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Sin agenda pendiente en el período." className="py-10" />
            ) : (
              <ul className="divide-y divide-border/70">
                {visibleAgenda.map((item) => {
                  const when = new Date(item.next_action_at);
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50">
                      {/* La hora en una baldosa de calendario: se lee primero. */}
                      <span className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-border bg-surface-raised py-1 leading-none">
                        <span className="text-[9px] font-semibold uppercase text-muted-foreground">
                          {when.toLocaleDateString("es-CL", { month: "short", timeZone: REPORT_TIME_ZONE }).replace(".", "")}
                        </span>
                        <span className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                          {when.toLocaleDateString("es-CL", { day: "numeric", timeZone: REPORT_TIME_ZONE })}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{item.lead_full_name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{item.reason ? reasonLabel(item.reason) : "Sin resultado"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Avatar name={item.agent_name} size="xs" />
                        <span className="hidden max-w-28 truncate sm:inline">{item.agent_name}</span>
                        <span className={`tabular-nums font-medium ${item.overdue ? "text-danger" : "text-foreground"}`}>
                          {when.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: REPORT_TIME_ZONE })}
                          {item.overdue && " · vencida"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Ranking de ejecutivos" description={`Ordenado por ${vocabulary.kpi.gestiones.toLowerCase()} del período.`}>
          <div className="max-h-96 overflow-y-auto border-t border-border">
            <Leaderboard
              primaryLabel={vocabulary.kpi.gestiones}
              rows={[...summary.agents]
                .sort((a, b) => b.gestiones - a.gestiones)
                .map((agent) => ({
                  id: agent.agent_id ?? agent.name,
                  name: agent.name,
                  primary: agent.gestiones,
                  stats: [
                    { label: "Contactos", value: fmtInt(agent.contactos) },
                    { label: vocabulary.kpi.cierreNota, value: fmtInt(agent.ventas), tone: agent.ventas > 0 ? ("good" as const) : undefined, strong: true },
                    { label: "UF", value: Number(agent.uf).toLocaleString("es-CL", { maximumFractionDigits: 1 }) },
                  ],
                }))}
            />
          </div>
        </SectionCard>
      </div>

      <p className="text-xs text-muted-foreground">{vocabulary.disclaimer}</p>
    </div>
  );
}
