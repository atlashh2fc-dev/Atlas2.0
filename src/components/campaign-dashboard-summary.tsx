"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CampaignDashboardSummary as CampaignDashboardSummaryData, CampaignDashboardSummaryMetric } from "@/lib/types";
import { CALL_REASONS } from "@/lib/call-typification";
import { REPORT_TIME_ZONE } from "@/lib/report-range";

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
}

const REASON_LABEL = new Map(CALL_REASONS.map((r) => [r.value, r.label]));

const CHART_COLORS = [
  "var(--primary)",
  "var(--accent)",
  "var(--foreground)",
  "var(--muted-foreground)",
  "var(--success)",
  "var(--warning)",
  "var(--danger)",
  "color-mix(in srgb, var(--primary) 62%, var(--accent))",
  "color-mix(in srgb, var(--muted-foreground) 55%, var(--accent))",
];

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
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Contactabilidad por hora</h3>
        {best && (
          <span className="text-xs text-muted-foreground">
            Mejor franja: <span className="font-medium text-foreground">{best.label}</span> ·{" "}
            {fmtPct((best.contactabilidad ?? 0) / 100)}
          </span>
        )}
      </div>

      {window.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Sin gestiones cerradas en el período.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={window}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              unit="%"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, name) =>
                name === "contactabilidad"
                  ? [`${Number(value).toFixed(1)}%`, "Contactabilidad"]
                  : [fmtInt(Number(value)), name === "contactos" ? "Contactos" : "Gestiones"]
              }
            />
            <Bar yAxisId="left" dataKey="gestiones" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="contactos" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="contactabilidad"
              stroke="var(--success)"
              strokeWidth={2}
              dot={false}
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
function FunnelStages({ stages }: { stages: { name: string; value: number }[] }) {
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
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${width}%` }}
                role="presentation"
              />
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

function DeltaBadge({ metric, invert = false }: { metric: CampaignDashboardSummaryMetric; invert?: boolean }) {
  const pct = metricPct(metric);
  if (pct === null) return <span className="text-xs text-muted-foreground">vs. período anterior: n/d</span>;
  const positive = invert ? pct < 0 : pct > 0;
  const isZero = Math.abs(pct) < 0.001;
  const color = isZero
    ? "text-muted-foreground"
    : positive
      ? "text-[color:var(--success)]"
      : "text-[color:var(--danger)]";
  const arrow = isZero ? "->" : pct > 0 ? "+" : "-";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(pct * 100).toFixed(1)}% vs. período anterior
    </span>
  );
}

function KpiCard({
  label,
  value,
  metric,
  highlight = false,
}: {
  label: string;
  value: string;
  metric?: CampaignDashboardSummaryMetric;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 ${highlight ? "ring-1 ring-primary/25" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {metric && <DeltaBadge metric={metric} />}
    </div>
  );
}

function ratio(current: number, total: number): number {
  return total > 0 ? current / total : 0;
}

export function CampaignDashboardSummary({ summary, hourly }: Props) {
  const kpis = summary.kpis;
  const contactabilidad = {
    current: ratio(kpis.contactadas.current, kpis.gestionadas.current),
    previous: ratio(kpis.contactadas.previous, kpis.gestionadas.previous),
  };
  const tasaConversion = {
    current: ratio(kpis.ventas.current, kpis.contactadas.current),
    previous: ratio(kpis.ventas.previous, kpis.contactadas.previous),
  };
  const reasonData = summary.reasons.map((r) => ({
    ...r,
    label: REASON_LABEL.get(r.reason) ?? r.reason,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted-foreground">
        {/* Con la zona del navegador, quien mire desde otro huso vería un día
            distinto al del reporte. El período es el de la operación. */}
        Período analizado: {formatOperationDate(summary.range.from)} -{" "}
        {formatOperationDate(summary.range.to)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Gestiones" value={fmtInt(kpis.gestionadas.current)} metric={kpis.gestionadas} />
        <KpiCard label="Contactabilidad" value={fmtPct(contactabilidad.current)} metric={contactabilidad} />
        <KpiCard label="Ventas en validación" value={fmtInt(kpis.ventas.current)} metric={kpis.ventas} highlight />
        <KpiCard label="Tasa de conversión" value={fmtPct(tasaConversion.current)} metric={tasaConversion} />
        <KpiCard label="UF en pipeline" value={`${Number(kpis.uf_total.current).toFixed(1)} UF`} metric={kpis.uf_total} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Embudo de gestión</h3>
          <FunnelStages stages={summary.funnel} />
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Evolución diaria</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={summary.time_series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area type="monotone" dataKey="gestiones" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.12} />
              <Line type="monotone" dataKey="ventas" stroke="var(--success)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Motivos de gestión</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={reasonData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {reasonData.map((entry, i) => (
                  <Cell key={entry.reason} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <ContactabilityByHour data={hourly} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Agenda y seguimientos</h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Lead</th>
                  <th className="py-1.5 font-medium">Ejecutivo</th>
                  <th className="py-1.5 font-medium">Motivo</th>
                  <th className="py-1.5 font-medium">Próxima acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.agenda.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Sin agenda pendiente en el período.
                    </td>
                  </tr>
                )}
                {summary.agenda.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 text-foreground">{item.lead_full_name}</td>
                    <td className="py-1.5 text-muted-foreground">{item.agent_name}</td>
                    <td className="py-1.5 text-muted-foreground">{REASON_LABEL.get(item.reason ?? "") ?? item.reason ?? "-"}</td>
                    <td className={`py-1.5 font-medium ${item.overdue ? "text-[color:var(--danger)]" : "text-foreground"}`}>
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
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Ranking de ejecutivos</h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Ejecutivo</th>
                  <th className="py-1.5 font-medium text-right">Gestiones</th>
                  <th className="py-1.5 font-medium text-right">Contactos</th>
                  <th className="py-1.5 font-medium text-right">Ventas</th>
                  <th className="py-1.5 font-medium text-right">UF</th>
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
                    <td className="py-1.5 text-right font-medium text-foreground">{fmtInt(agent.ventas)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{Number(agent.uf).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Nota: &quot;Venta en validación&quot; refleja la oportunidad registrada por el ejecutivo en la tipificación,
        no necesariamente un cierre/facturación confirmado por backoffice.
      </p>
    </div>
  );
}
