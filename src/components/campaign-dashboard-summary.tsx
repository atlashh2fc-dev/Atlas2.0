"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarClock,
  CalendarRange,
  Clock,
  Coins,
  Funnel,
  Headset,
  Minus,
  Network,
  PhoneCall,
  Trophy,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  CHART_AXIS_TICK,
  CHART_COLOR,
  CHART_CURSOR,
  CHART_GRID,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  chartGradients,
  gradientUrl,
  useChartId,
} from "@/components/chart-theme";
import { Badge, EmptyState, MetricIconChip, SectionCard, type IconTone } from "@/components/ui";
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
function ContactabilityByHour({ data }: { data: ContactabilityHour[] }) {
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

  return (
    <SectionCard
      title="Contactabilidad por hora"
      icon={Clock}
      tone="amber"
      actions={
        best && (
          <Badge tone="success" className="shrink-0">
            Mejor franja: <span className="font-semibold">{best.label}</span> ·{" "}
            {fmtPct((best.contactabilidad ?? 0) / 100)}
          </Badge>
        )
      }
    >
      <div className="p-5">
      {window.length === 0 ? (
        <EmptyState icon={Clock} title="Sin gestiones cerradas en el período." />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={window} barGap={2}>
            {chartGradients(chartId, ["slate", "primary"])}
            <CartesianGrid {...CHART_GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} />
            <YAxis yAxisId="left" tick={CHART_AXIS_TICK} />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              unit="%"
              tick={CHART_AXIS_TICK}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              labelStyle={CHART_TOOLTIP_LABEL_STYLE}
              cursor={CHART_CURSOR}
              formatter={(value, name) =>
                name === "contactabilidad"
                  ? [`${Number(value).toFixed(1)}%`, "Contactabilidad"]
                  : [fmtInt(Number(value)), name === "contactos" ? "Contactos" : "Gestiones"]
              }
            />
            <Bar yAxisId="left" dataKey="gestiones" fill={gradientUrl(chartId, "slate")} fillOpacity={0.55} radius={[5, 5, 0, 0]} maxBarSize={22} />
            <Bar yAxisId="left" dataKey="contactos" fill={gradientUrl(chartId, "primary")} radius={[5, 5, 0, 0]} maxBarSize={22} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="contactabilidad"
              stroke={CHART_COLOR.green}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Barras: gestiones cerradas y cuántas terminaron en conversación. Línea: porcentaje de
        contacto de esa hora.
      </p>
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
    <ol className="space-y-3">
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].value : null;
        const shareOfBase = base > 0 ? stage.value / base : 0;
        const stepConversion = previous && previous > 0 ? stage.value / previous : null;
        // Sin el mínimo, cualquier etapa por debajo del 1% de la base
        // desaparece y no se distingue de un cero.
        const width = stage.value > 0 ? Math.max(shareOfBase * 100, 1.5) : 0;

        return (
          <li key={stage.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium text-foreground">{stage.name}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {fmtInt(stage.value)}
                </span>
                {stepConversion !== null && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {fmtPct(stepConversion)} de {stages[index - 1].name.toLowerCase()}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
              {/* La última etapa es el cierre y va en verde; las demás en la marca. */}
              <div
                className="h-full rounded-full"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${index === stages.length - 1 ? "var(--success)" : "var(--primary)"} 55%, transparent), ${index === stages.length - 1 ? "var(--success)" : "var(--primary)"})`,
                }}
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

function DeltaBadge({ metric, invert = false }: { metric: CampaignDashboardSummaryMetric; invert?: boolean }) {
  const pct = metricPct(metric);
  if (pct === null) return <span className="text-xs text-muted-foreground">vs. período anterior: n/d</span>;
  const positive = invert ? pct < 0 : pct > 0;
  const isZero = Math.abs(pct) < 0.001;
  const color = isZero ? "text-muted-foreground" : positive ? "text-success" : "text-danger";
  const Arrow = isZero ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`mt-1 inline-flex items-center gap-1 text-xs font-medium tabular-nums ${color}`}>
      <Arrow size={13} aria-hidden="true" />
      {Math.abs(pct * 100).toFixed(1)}%
      <span className="font-normal text-muted-foreground">vs. período anterior</span>
    </span>
  );
}

function KpiCard({
  label,
  value,
  metric,
  icon,
  iconTone,
  highlight = false,
}: {
  label: string;
  value: string;
  metric?: CampaignDashboardSummaryMetric;
  icon: LucideIcon;
  iconTone: IconTone;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-4 shadow-sm ${highlight ? "border-success/40 ring-1 ring-success/20" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <MetricIconChip icon={icon} tone={iconTone} />
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${highlight ? "text-success" : "text-foreground"}`}>
        {value}
      </p>
      {metric && <DeltaBadge metric={metric} />}
    </div>
  );
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
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted-foreground shadow-sm">
        <CalendarRange size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        {/* Con la zona del navegador, quien mire desde otro huso vería un día
            distinto al del reporte. El período es el de la operación. */}
        <span>
          Período analizado:{" "}
          <span className="font-medium text-foreground">
            {formatOperationDate(summary.range.from)} - {formatOperationDate(summary.range.to)}
          </span>
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label={vocabulary.kpi.gestiones} value={fmtInt(kpis.gestionadas.current)} metric={kpis.gestionadas} icon={Headset} iconTone="primary" />
        <KpiCard label={vocabulary.kpi.contactabilidad} value={fmtPct(contactabilidad.current)} metric={contactabilidad} icon={PhoneCall} iconTone="teal" />
        <KpiCard label={vocabulary.kpi.cierre} value={fmtInt(kpis.ventas.current)} metric={kpis.ventas} icon={Trophy} iconTone="green" highlight />
        <KpiCard label={vocabulary.kpi.conversion} value={fmtPct(tasaConversion.current)} metric={tasaConversion} icon={TrendingUp} iconTone="green" />
        <KpiCard label={vocabulary.kpi.monto} value={`${Number(kpis.uf_total.current).toFixed(1)} UF`} metric={kpis.uf_total} icon={Coins} iconTone="green" />
      </div>

      {channelFunnel && channelFunnel.length > 0 && <ChannelFunnelTable rows={channelFunnel} range={summary.range} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={vertical === "cobranza" ? "Embudo de recuperación" : "Embudo de gestión"}
          description={showFunnelOrigins ? "Cada etapa se desglosa por la procedencia registrada del lead." : undefined}
          icon={Funnel}
          tone="violet"
        >
          <div className="p-5">
            <FunnelStages stages={funnel} showOrigins={showFunnelOrigins} />
          </div>
        </SectionCard>

        <SectionCard title={vocabulary.evolucionTitle} icon={TrendingUp} tone="violet">
          <div className="p-5">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={summary.time_series}>
              {chartGradients(evolutionChartId, ["primary"], "area")}
              <CartesianGrid {...CHART_GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} />
              <YAxis tick={CHART_AXIS_TICK} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                cursor={{ stroke: "var(--border-strong)" }}
              />
              <Area
                type="monotone"
                dataKey="gestiones"
                stroke={CHART_COLOR.primary}
                fill={gradientUrl(evolutionChartId, "primary")}
                strokeWidth={2.25}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Line type="monotone" dataKey="ventas" stroke={CHART_COLOR.green} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </SectionCard>

        <ContactabilityByHour data={hourly} />
      </div>

      {/* A ancho completo: es el bloque con más contenido del tablero y en media
          columna obligaba a una lista vertical de veinte filas contra un vacío
          a la derecha. Acá los resultados caben lado a lado. */}
      <TipificationBreakdown breakdown={tipifications} title={vocabulary.motivosTitle} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={vocabulary.agendaTitle} icon={CalendarClock} tone="amber">
          <div className="max-h-80 overflow-y-auto px-5 pb-4">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-border bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="h-10 font-medium">
                    {vertical === "cobranza" ? "Deudor" : "Lead"}
                  </th>
                  <th className="h-10 font-medium">Ejecutivo</th>
                  <th className="h-10 font-medium">Resultado</th>
                  <th className="h-10 font-medium">Próxima acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleAgenda.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Sin agenda pendiente en el período.
                    </td>
                  </tr>
                )}
                {visibleAgenda.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 text-foreground">{item.lead_full_name}</td>
                    <td className="py-1.5 text-muted-foreground">{item.agent_name}</td>
                    <td className="py-1.5 text-muted-foreground">{item.reason ? reasonLabel(item.reason) : "-"}</td>
                    <td className={`py-1.5 font-medium ${item.overdue ? "text-danger" : "text-foreground"}`}>
                      {new Date(item.next_action_at).toLocaleString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {item.overdue && " (vencida)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Ranking de ejecutivos" icon={Users} tone="blue">
          <div className="max-h-80 overflow-y-auto px-5 pb-4">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-border bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="h-10 font-medium">Ejecutivo</th>
                  <th className="h-10 font-medium text-right">Gestiones</th>
                  <th className="h-10 font-medium text-right">Contactos</th>
                  <th className="h-10 font-medium text-right">{vocabulary.kpi.cierreNota}</th>
                  <th className="h-10 font-medium text-right">UF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.agents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      Sin datos en el período.
                    </td>
                  </tr>
                )}
                {summary.agents.map((agent) => (
                  <tr key={agent.agent_id ?? agent.name}>
                    <td className="py-1.5 text-foreground">{agent.name}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtInt(agent.gestiones)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtInt(agent.contactos)}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${agent.ventas > 0 ? "text-success" : "text-foreground"}`}>{fmtInt(agent.ventas)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{Number(agent.uf).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <p className="text-xs text-muted-foreground">{vocabulary.disclaimer}</p>
    </div>
  );
}
