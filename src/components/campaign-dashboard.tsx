"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  FunnelChart,
  Funnel,
  LabelList,
  ComposedChart,
  Line,
  Area,
} from "recharts";
import type { CampaignDashboardCall } from "@/lib/types";
import { CALL_REASONS, EQUIFAX_PRODUCTS } from "@/lib/call-typification";

interface Props {
  calls: CampaignDashboardCall[];
  totalLeads: number;
  agentOptions: { id: string; name: string }[];
  initialDateFrom?: string;
  initialDateTo?: string;
  loadedDateFrom?: string;
  loadedDateTo?: string;
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
  return n.toLocaleString("es-CL");
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

interface Delta {
  current: number;
  previous: number;
  pct: number | null;
}

function delta(current: number, previous: number): Delta {
  if (previous === 0) return { current, previous, pct: current === 0 ? 0 : null };
  return { current, previous, pct: (current - previous) / previous };
}

function DeltaBadge({ d, invert = false }: { d: Delta; invert?: boolean }) {
  if (d.pct === null) return <span className="text-xs text-muted-foreground">vs. período anterior: n/d</span>;
  const positive = invert ? d.pct < 0 : d.pct > 0;
  const isZero = Math.abs(d.pct) < 0.001;
  const color = isZero
    ? "text-muted-foreground"
    : positive
      ? "text-[color:var(--success)]"
      : "text-[color:var(--danger)]";
  const arrow = isZero ? "→" : d.pct > 0 ? "↑" : "↓";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(d.pct * 100).toFixed(1)}% vs. período anterior
    </span>
  );
}

export function CampaignDashboard({
  calls,
  totalLeads,
  agentOptions,
  initialDateFrom = "",
  initialDateTo = "",
  loadedDateFrom,
  loadedDateTo,
}: Props) {
  const [dateFrom, setDateFrom] = useState<string>(initialDateFrom);
  const [dateTo, setDateTo] = useState<string>(initialDateTo);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const bounds = useMemo(() => {
    if (calls.length === 0) return null;
    const times = calls.map((c) => new Date(c.started_at).getTime());
    return { min: new Date(Math.min(...times)), max: new Date(Math.max(...times)) };
  }, [calls]);

  const range = useMemo(() => {
    const to = dateTo ? startOfDay(new Date(dateTo)) : bounds?.max ?? new Date();
    to.setHours(23, 59, 59, 999);
    const from = dateFrom ? startOfDay(new Date(dateFrom)) : bounds?.min ?? new Date(0);
    return { from, to };
  }, [dateFrom, dateTo, bounds]);

  const prevRange = useMemo(() => {
    const spanMs = range.to.getTime() - range.from.getTime();
    const prevTo = new Date(range.from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    return { from: prevFrom, to: prevTo };
  }, [range]);

  const inRange = (call: CampaignDashboardCall, r: { from: Date; to: Date }) => {
    const t = new Date(call.started_at).getTime();
    return t >= r.from.getTime() && t <= r.to.getTime();
  };

  const currentCalls = useMemo(() => calls.filter((c) => inRange(c, range)), [calls, range]);
  const previousCalls = useMemo(() => calls.filter((c) => inRange(c, prevRange)), [calls, prevRange]);

  // Filtros adicionales aplicados solo a la vista "filtrada" (cross-filter), no a las comparativas base.
  const filtered = useMemo(() => {
    return currentCalls.filter((c) => {
      if (selectedAgents.size > 0 && !selectedAgents.has(c.agent_id)) return false;
      if (selectedReason && c.reason !== selectedReason) return false;
      if (selectedProduct && !(c.equifax_products ?? []).includes(selectedProduct)) return false;
      return true;
    });
  }, [currentCalls, selectedAgents, selectedReason, selectedProduct]);

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const gestionadas = filtered.length;
    const contactadas = filtered.filter((c) => c.status === "connected").length;
    const ventas = filtered.filter((c) => c.reason === "VENTA EN VALIDACION").length;
    const ufTotal = filtered
      .filter((c) => c.reason === "VENTA EN VALIDACION")
      .reduce((sum, c) => sum + (c.equifax_uf_amount ?? 0), 0);
    const cotizaciones = filtered.filter((c) => c.reason === "COTIZACION ENVIADA").length;

    const prevGestionadas = previousCalls.length;
    const prevContactadas = previousCalls.filter((c) => c.status === "connected").length;
    const prevVentas = previousCalls.filter((c) => c.reason === "VENTA EN VALIDACION").length;
    const prevUf = previousCalls
      .filter((c) => c.reason === "VENTA EN VALIDACION")
      .reduce((sum, c) => sum + (c.equifax_uf_amount ?? 0), 0);

    return {
      gestionadas: delta(gestionadas, prevGestionadas),
      contactabilidad: delta(
        gestionadas > 0 ? contactadas / gestionadas : 0,
        prevGestionadas > 0 ? prevContactadas / prevGestionadas : 0
      ),
      ventas: delta(ventas, prevVentas),
      tasaConversion: delta(
        contactadas > 0 ? ventas / contactadas : 0,
        prevContactadas > 0 ? prevVentas / prevContactadas : 0
      ),
      ufTotal: delta(ufTotal, prevUf),
      cotizaciones,
    };
  }, [filtered, previousCalls]);

  // ---- Embudo ----
  const funnelData = useMemo(() => {
    const gestionados = new Set(filtered.map((c) => c.lead_id)).size;
    const contactados = new Set(filtered.filter((c) => c.status === "connected").map((c) => c.lead_id)).size;
    const conResultado = new Set(
      filtered.filter((c) => c.reason && c.reason !== "GESTION EN CURSO" && c.status === "connected").map((c) => c.lead_id)
    ).size;
    const ventaValidacion = new Set(
      filtered.filter((c) => c.reason === "VENTA EN VALIDACION").map((c) => c.lead_id)
    ).size;

    return [
      { name: "BBDD asignada", value: totalLeads, fill: CHART_COLORS[0] },
      { name: "Gestionados", value: gestionados, fill: CHART_COLORS[1] },
      { name: "Contactados", value: contactados, fill: CHART_COLORS[2] },
      { name: "Con resultado", value: conResultado, fill: CHART_COLORS[3] },
      { name: "Venta en validación", value: ventaValidacion, fill: CHART_COLORS[4] },
    ];
  }, [filtered, totalLeads]);

  // ---- Distribución de motivos ----
  const reasonData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of filtered) {
      if (!c.reason || c.reason === "GESTION EN CURSO") continue;
      counts.set(c.reason, (counts.get(c.reason) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, label: REASON_LABEL.get(reason) ?? reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ---- Mix de productos Equifax ----
  const productData = useMemo(() => {
    const counts = new Map<string, { count: number; uf: number }>();
    for (const p of EQUIFAX_PRODUCTS) counts.set(p, { count: 0, uf: 0 });
    for (const c of filtered) {
      for (const p of c.equifax_products ?? []) {
        const entry = counts.get(p) ?? { count: 0, uf: 0 };
        entry.count += 1;
        entry.uf += c.equifax_uf_amount ?? 0;
        counts.set(p, entry);
      }
    }
    return Array.from(counts.entries())
      .map(([product, v]) => ({ product, ...v }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ---- Serie de tiempo (gestiones y ventas por día, con proyección lineal simple) ----
  const timeSeries = useMemo(() => {
    const byDay = new Map<string, { gestiones: number; ventas: number }>();
    for (const c of filtered) {
      const k = dayKey(c.started_at);
      const e = byDay.get(k) ?? { gestiones: 0, ventas: 0 };
      e.gestiones += 1;
      if (c.reason === "VENTA EN VALIDACION") e.ventas += 1;
      byDay.set(k, e);
    }
    const days = Array.from(byDay.keys()).sort();
    const series = days.map((d) => ({ date: d, ...byDay.get(d)! }));

    if (series.length >= 3) {
      const n = series.length;
      const avgGrowth =
        (series[n - 1].gestiones - series[0].gestiones) / Math.max(1, n - 1);
      const lastDate = new Date(days[n - 1]);
      const projected = [...series];
      for (let i = 1; i <= 5; i++) {
        const nd = new Date(lastDate);
        nd.setDate(nd.getDate() + i);
        projected.push({
          date: nd.toISOString().slice(0, 10),
          gestiones: Math.max(0, Math.round(series[n - 1].gestiones + avgGrowth * i)),
          ventas: undefined as unknown as number,
        });
      }
      return projected;
    }
    return series;
  }, [filtered]);

  // ---- Agenda / callbacks pendientes ----
  const [now] = useState(() => Date.now());
  const agendaRows = useMemo(() => {
    return filtered
      .filter((c) => c.next_action_at)
      .map((c) => ({
        ...c,
        overdue: new Date(c.next_action_at!).getTime() < now,
      }))
      .sort((a, b) => new Date(a.next_action_at!).getTime() - new Date(b.next_action_at!).getTime());
  }, [filtered, now]);

  // ---- Ranking de agentes ----
  const agentRanking = useMemo(() => {
    const byAgent = new Map<
      string,
      { name: string; gestiones: number; contactos: number; ventas: number; uf: number }
    >();
    for (const c of filtered) {
      const e = byAgent.get(c.agent_id) ?? { name: c.agent_name, gestiones: 0, contactos: 0, ventas: 0, uf: 0 };
      e.gestiones += 1;
      if (c.status === "connected") e.contactos += 1;
      if (c.reason === "VENTA EN VALIDACION") {
        e.ventas += 1;
        e.uf += c.equifax_uf_amount ?? 0;
      }
      byAgent.set(c.agent_id, e);
    }
    return Array.from(byAgent.values()).sort((a, b) => b.ventas - a.ventas || b.gestiones - a.gestiones);
  }, [filtered]);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasActiveFilters =
    selectedAgents.size > 0 || selectedReason !== null || selectedProduct !== null || dateFrom !== "" || dateTo !== "";

  return (
    <div className="space-y-6">
      {/* Filtros globales */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Desde</label>
          <input
            type="date"
            value={dateFrom}
            min={loadedDateFrom}
            max={loadedDateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Hasta</label>
          <input
            type="date"
            value={dateTo}
            min={loadedDateFrom}
            max={loadedDateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>

        {agentOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Ejecutivos:</span>
            {agentOptions.map((a) => (
              <button
                key={a.id}
                onClick={() => toggleAgent(a.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selectedAgents.has(a.id)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-muted"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}

        {hasActiveFilters && (
          <button
            onClick={() => {
              setSelectedAgents(new Set());
              setSelectedReason(null);
              setSelectedProduct(null);
              setDateFrom("");
              setDateTo("");
            }}
            className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-muted"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {(selectedReason || selectedProduct) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Filtro activo (clic en el gráfico para quitar):</span>
          {selectedReason && (
            <button
              onClick={() => setSelectedReason(null)}
              className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground"
            >
              Motivo: {REASON_LABEL.get(selectedReason) ?? selectedReason} ✕
            </button>
          )}
          {selectedProduct && (
            <button
              onClick={() => setSelectedProduct(null)}
              className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground"
            >
              Producto: {selectedProduct} ✕
            </button>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Gestiones" value={fmtInt(kpis.gestionadas.current)} delta={kpis.gestionadas} />
        <KpiCard label="Contactabilidad" value={fmtPct(kpis.contactabilidad.current)} delta={kpis.contactabilidad} />
        <KpiCard label="Ventas en validación" value={fmtInt(kpis.ventas.current)} delta={kpis.ventas} highlight />
        <KpiCard
          label="Tasa de conversión (sobre contactados)"
          value={fmtPct(kpis.tasaConversion.current)}
          delta={kpis.tasaConversion}
        />
        <KpiCard label="UF en pipeline" value={`${kpis.ufTotal.current.toFixed(1)} UF`} delta={kpis.ufTotal} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Embudo */}
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
              <Funnel dataKey="value" data={funnelData} isAnimationActive>
                <LabelList position="right" dataKey="name" fill="var(--foreground)" stroke="none" fontSize={12} />
                <LabelList position="center" dataKey="value" fill="var(--primary-foreground)" stroke="none" fontSize={13} fontWeight={600} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>

        {/* Serie de tiempo */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Evolución diaria <span className="text-xs font-normal text-muted-foreground">(línea punteada = proyección)</span>
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={timeSeries}>
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

        {/* Distribución de motivos */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Motivos de gestión <span className="text-xs font-normal text-muted-foreground">(clic para filtrar)</span>
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={reasonData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer">
                {reasonData.map((entry, i) => (
                  <Cell
                    key={entry.reason}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    opacity={selectedReason && selectedReason !== entry.reason ? 0.35 : 1}
                    onClick={() => setSelectedReason(selectedReason === entry.reason ? null : entry.reason)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Mix de productos */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Mix de productos Equifax <span className="text-xs font-normal text-muted-foreground">(clic para filtrar)</span>
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={productData}>
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
              <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer">
                {productData.map((entry, i) => (
                  <Cell
                    key={entry.product}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    opacity={selectedProduct && selectedProduct !== entry.product ? 0.35 : 1}
                    onClick={() => setSelectedProduct(selectedProduct === entry.product ? null : entry.product)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Agenda / callbacks */}
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
                {agendaRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Sin agenda pendiente en el período/filtro seleccionado.
                    </td>
                  </tr>
                )}
                {agendaRows.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 text-foreground">{c.lead_full_name}</td>
                    <td className="py-1.5 text-muted-foreground">{c.agent_name}</td>
                    <td className="py-1.5 text-muted-foreground">{REASON_LABEL.get(c.reason ?? "") ?? c.reason}</td>
                    <td className={`py-1.5 font-medium ${c.overdue ? "text-[color:var(--danger)]" : "text-foreground"}`}>
                      {new Date(c.next_action_at!).toLocaleString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {c.overdue && " (vencida)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Ranking de agentes */}
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
                {agentRanking.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      Sin datos en el período/filtro seleccionado.
                    </td>
                  </tr>
                )}
                {agentRanking.map((a, i) => (
                  <tr key={a.name}>
                    <td className="py-1.5 text-foreground">
                      {i === 0 && a.ventas > 0 && "🏆 "}
                      {a.name}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtInt(a.gestiones)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtInt(a.contactos)}</td>
                    <td className="py-1.5 text-right font-medium text-foreground">{fmtInt(a.ventas)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{a.uf.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Nota: &quot;Venta en validación&quot; refleja la oportunidad registrada por el ejecutivo en la tipificación,
        no necesariamente un cierre/facturación confirmado por backoffice. Úsalo como indicador de pipeline.
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta: d,
  highlight,
}: {
  label: string;
  value: string;
  delta: Delta;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border bg-surface"
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <div className="mt-1">
        <DeltaBadge d={d} />
      </div>
    </div>
  );
}
