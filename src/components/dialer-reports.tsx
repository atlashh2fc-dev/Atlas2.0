"use client";

import { useEffect, useState } from "react";
import {
  getAgentActivityReport,
  getCallMetricsReport,
  listCampaignsForReports,
} from "@/app/actions/dialer-reports";
import type { AgentActivityReportRow, CallMetricsReportRow } from "@/lib/types";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: isoDate(from), to: isoDate(to) };
}

function formatSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" | "warning" }) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className={`text-xl font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function DialerReports() {
  const [{ from, to }, setRange] = useState(defaultRange());
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const [campaignId, setCampaignId] = useState<string>("");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [callMetrics, setCallMetrics] = useState<CallMetricsReportRow[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCampaignsForReports().then(setCampaigns).catch(() => {});
  }, []);

  // Ojo: no llamar setLoading/setError de forma síncrona al inicio del efecto
  // (dispara el lint react-hooks/set-state-in-effect por cascada de renders).
  // El indicador "Cargando..." se activa desde los handlers de los filtros
  // (onClick de Aplicar, onChange de campaña) y este efecto solo lo apaga.
  useEffect(() => {
    let disposed = false;
    Promise.all([
      getCallMetricsReport(from, to, campaignId || null),
      getAgentActivityReport(from, to),
    ])
      .then(([cm, aa]) => {
        if (disposed) return;
        setCallMetrics(cm);
        setAgentActivity(aa);
        setError(null);
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : "Error al cargar el reporte");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [from, to, campaignId]);

  const totals = callMetrics.reduce(
    (acc, r) => {
      acc.total_attempts += r.total_attempts;
      acc.answered += r.answered;
      acc.completed += r.completed;
      acc.abandoned += r.abandoned;
      acc.no_answer += r.no_answer;
      return acc;
    },
    { total_attempts: 0, answered: 0, completed: 0, abandoned: 0, no_answer: 0 }
  );
  const abandonRate = totals.answered > 0 ? (totals.abandoned / totals.answered) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground">Desde</label>
          <input
            type="date"
            value={pendingFrom}
            onChange={(e) => setPendingFrom(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground">Hasta</label>
          <input
            type="date"
            value={pendingTo}
            onChange={(e) => setPendingTo(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground">Campaña</label>
          <select
            value={campaignId}
            onChange={(e) => {
              setLoading(true);
              setCampaignId(e.target.value);
            }}
            className="mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            setRange({ from: pendingFrom, to: pendingTo });
          }}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Aplicar
        </button>
        {loading && <span className="text-xs text-muted-foreground">Cargando...</span>}
      </div>

      {error && <p className="text-sm text-danger">Error: {error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Intentos" value={String(totals.total_attempts)} />
        <SummaryCard label="Contestadas" value={String(totals.answered)} tone="success" />
        <SummaryCard label="Completadas" value={String(totals.completed)} />
        <SummaryCard label="No contesta" value={String(totals.no_answer)} />
        <SummaryCard
          label={`Abandono (${totals.abandoned})`}
          value={abandonRate != null ? formatPercent(abandonRate) : "—"}
          tone={abandonRate != null && abandonRate > 6 ? "danger" : "success"}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Métricas de llamadas por día y campaña</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Campaña</th>
                <th className="p-3 font-medium text-right">Intentos</th>
                <th className="p-3 font-medium text-right">Contest.</th>
                <th className="p-3 font-medium text-right">Complet.</th>
                <th className="p-3 font-medium text-right">No contesta</th>
                <th className="p-3 font-medium text-right">Ocupado</th>
                <th className="p-3 font-medium text-right">Abandono</th>
                <th className="p-3 font-medium text-right">Ring prom.</th>
                <th className="p-3 font-medium text-right">AHT</th>
                <th className="p-3 font-medium text-right">% Abandono</th>
                <th className="p-3 font-medium text-right">NS 20s</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {callMetrics.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="p-5 text-center text-muted-foreground">
                    Sin datos para el rango seleccionado.
                  </td>
                </tr>
              )}
              {callMetrics.map((r, i) => (
                <tr key={`${r.report_date}-${r.campaign_id}-${i}`}>
                  <td className="p-3 text-foreground">{r.report_date}</td>
                  <td className="p-3 text-foreground">{r.campaign_name}</td>
                  <td className="p-3 text-right tabular-nums">{r.total_attempts}</td>
                  <td className="p-3 text-right tabular-nums">{r.answered}</td>
                  <td className="p-3 text-right tabular-nums">{r.completed}</td>
                  <td className="p-3 text-right tabular-nums">{r.no_answer}</td>
                  <td className="p-3 text-right tabular-nums">{r.busy}</td>
                  <td className={`p-3 text-right tabular-nums ${r.abandoned > 0 ? "text-danger" : ""}`}>{r.abandoned}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.avg_ring_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.avg_talk_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPercent(r.abandonment_rate)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPercent(r.service_level_20s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Actividad por agente</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Ocupación: tiempo en llamada/wrap-up sobre tiempo conectado. Adherencia: tiempo Disponible sobre
            tiempo en motivos no-sistema (excluye desconexiones).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Agente</th>
                <th className="p-3 font-medium text-right">Llamadas</th>
                <th className="p-3 font-medium text-right">Talk time</th>
                <th className="p-3 font-medium text-right">AHT</th>
                <th className="p-3 font-medium text-right">Conectado</th>
                <th className="p-3 font-medium text-right">Productivo</th>
                <th className="p-3 font-medium text-right">Ocupación</th>
                <th className="p-3 font-medium text-right">Disponible</th>
                <th className="p-3 font-medium text-right">Pausado</th>
                <th className="p-3 font-medium text-right">Adherencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agentActivity.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="p-5 text-center text-muted-foreground">
                    Sin actividad para el rango seleccionado.
                  </td>
                </tr>
              )}
              {agentActivity.map((r) => (
                <tr key={r.profile_id}>
                  <td className="p-3 text-foreground">{r.full_name}</td>
                  <td className="p-3 text-right tabular-nums">{r.calls_handled}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.talk_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.avg_handle_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.logged_in_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.productive_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPercent(r.occupancy_rate)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.available_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSeconds(r.paused_seconds)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPercent(r.adherence_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
