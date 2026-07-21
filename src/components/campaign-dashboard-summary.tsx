"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CampaignDashboardSummary as CampaignDashboardSummaryData, CampaignDashboardSummaryMetric } from "@/lib/types";
import { CALL_REASONS } from "@/lib/call-typification";

interface Props {
  summary: CampaignDashboardSummaryData;
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

export function CampaignDashboardSummary({ summary }: Props) {
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
        Período analizado: {new Date(summary.range.from).toLocaleDateString("es-CL")} -{" "}
        {new Date(summary.range.to).toLocaleDateString("es-CL")}
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
          <ResponsiveContainer width="100%" height={280}>
            <FunnelChart>
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => fmtInt(Number(value))}
              />
              <Funnel dataKey="value" data={summary.funnel} isAnimationActive>
                <LabelList position="right" dataKey="name" fill="var(--foreground)" stroke="none" fontSize={12} />
                <LabelList position="center" dataKey="value" fill="var(--primary-foreground)" stroke="none" fontSize={13} fontWeight={600} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
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

        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Mix de productos comerciales</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={summary.products}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="product"
                tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                angle={-25}
                textAnchor="end"
                height={60}
                interval={0}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => [fmtInt(Number(value)), "Cotizaciones/ventas"] as [string, string]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {summary.products.map((entry, i) => (
                  <Cell key={entry.product} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
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
