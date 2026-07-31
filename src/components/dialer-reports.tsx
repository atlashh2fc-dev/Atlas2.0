"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAgentActivityReport,
  getCallMetricsReport,
  listCampaignsForReports,
} from "@/app/actions/dialer-reports";
import type { AgentActivityReportRow, CallMetricsReportRow } from "@/lib/types";
import {
  Button,
  Card,
  DataTable,
  Field,
  InfoTooltip,
  Input,
  LoadingState,
  MetricCard,
  SectionCard,
  Select,
  type Column,
} from "@/components/ui";

const RANGE_PRESETS = [
  { id: "hoy", label: "Hoy", days: 0 },
  { id: "7d", label: "7 días", days: 6 },
  { id: "30d", label: "30 días", days: 29 },
] as const;

const ABANDON_ALERT_RATE = 6;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: isoDate(from), to: isoDate(to) };
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return "—";
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function DialerReports() {
  const [{ from, to }, setRange] = useState(() => rangeFor(6));
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);
  const [campaignId, setCampaignId] = useState<string>("");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [callMetrics, setCallMetrics] = useState<CallMetricsReportRow[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const selectedCampaignName = campaigns.find((campaign) => campaign.id === campaignId)?.name ?? null;

  useEffect(() => {
    listCampaignsForReports().then(setCampaigns).catch(() => {});
  }, []);

  // Ojo: no llamar setLoading/setError de forma síncrona al inicio del efecto
  // (dispara el lint react-hooks/set-state-in-effect por cascada de renders).
  // El indicador de carga se activa desde los handlers y este efecto lo apaga.
  useEffect(() => {
    let disposed = false;
    Promise.all([
      getCallMetricsReport(from, to, campaignId || null),
      getAgentActivityReport(from, to, campaignId || null),
    ])
      .then(([metrics, activity]) => {
        if (disposed) return;
        setCallMetrics(metrics);
        setAgentActivity(activity);
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
  }, [from, to, campaignId, reloadToken]);

  const applyRange = useCallback((next: { from: string; to: string }) => {
    setLoading(true);
    setPendingFrom(next.from);
    setPendingTo(next.to);
    setRange(next);
  }, []);

  const totals = callMetrics.reduce(
    (accumulator, row) => {
      accumulator.total_attempts += row.total_attempts;
      accumulator.answered += row.answered;
      accumulator.completed += row.completed;
      accumulator.abandoned += row.abandoned;
      accumulator.no_answer += row.no_answer;
      return accumulator;
    },
    { total_attempts: 0, answered: 0, completed: 0, abandoned: 0, no_answer: 0 }
  );
  const abandonRate = totals.answered > 0 ? (totals.abandoned / totals.answered) * 100 : null;

  const metricColumns = useMemo<Column<CallMetricsReportRow>[]>(
    () => [
      { id: "fecha", header: "Fecha", value: (row) => row.report_date, cell: (row) => formatDate(row.report_date) },
      { id: "campana", header: "Campaña", value: (row) => row.campaign_name },
      { id: "intentos", header: "Intentos", align: "right", value: (row) => row.total_attempts },
      { id: "contestadas", header: "Contestadas", align: "right", value: (row) => row.answered },
      { id: "completadas", header: "Completadas", align: "right", value: (row) => row.completed },
      { id: "no_contesta", header: "No contesta", align: "right", value: (row) => row.no_answer },
      { id: "ocupado", header: "Ocupado", align: "right", value: (row) => row.busy },
      {
        id: "abandonadas",
        header: "Abandonadas",
        align: "right",
        metric: "abandono",
        value: (row) => row.abandoned,
        cell: (row) => <span className={row.abandoned > 0 ? "text-danger" : undefined}>{row.abandoned}</span>,
      },
      {
        id: "ring",
        header: "Timbrado promedio",
        align: "right",
        metric: "ring_promedio",
        value: (row) => row.avg_ring_seconds,
        cell: (row) => formatSeconds(row.avg_ring_seconds),
      },
      {
        id: "aht",
        header: "AHT",
        align: "right",
        metric: "aht",
        value: (row) => row.avg_talk_seconds,
        cell: (row) => formatSeconds(row.avg_talk_seconds),
      },
      {
        id: "tasa_abandono",
        header: "% abandono",
        align: "right",
        metric: "abandono",
        value: (row) => row.abandonment_rate,
        cell: (row) => (
          <span
            className={
              row.abandonment_rate != null && row.abandonment_rate > ABANDON_ALERT_RATE ? "font-medium text-danger" : undefined
            }
          >
            {formatPercent(row.abandonment_rate)}
          </span>
        ),
      },
      {
        id: "nivel_servicio",
        header: "Nivel de servicio 20 s",
        align: "right",
        metric: "nivel_servicio_20s",
        value: (row) => row.service_level_20s,
        cell: (row) => formatPercent(row.service_level_20s),
      },
    ],
    []
  );

  const activityColumns = useMemo<Column<AgentActivityReportRow>[]>(
    () => [
      { id: "agente", header: "Ejecutivo", value: (row) => row.full_name },
      { id: "llamadas", header: "Llamadas", align: "right", value: (row) => row.calls_handled },
      {
        id: "talk",
        header: "Tiempo en conversación",
        align: "right",
        metric: "talk_time",
        value: (row) => row.talk_seconds,
        cell: (row) => formatSeconds(row.talk_seconds),
      },
      {
        id: "aht",
        header: "AHT",
        align: "right",
        metric: "aht",
        value: (row) => row.avg_handle_seconds,
        cell: (row) => formatSeconds(row.avg_handle_seconds),
      },
      {
        id: "conectado",
        header: "Conectado",
        align: "right",
        value: (row) => row.logged_in_seconds,
        cell: (row) => formatSeconds(row.logged_in_seconds),
      },
      {
        id: "productivo",
        header: "Productivo",
        align: "right",
        value: (row) => row.productive_seconds,
        cell: (row) => formatSeconds(row.productive_seconds),
      },
      {
        id: "ocupacion",
        header: "Ocupación",
        align: "right",
        metric: "ocupacion",
        value: (row) => row.occupancy_rate,
        cell: (row) => formatPercent(row.occupancy_rate),
      },
      {
        id: "jornada",
        header: "Jornada programada",
        align: "right",
        value: (row) => row.scheduled_seconds,
        cell: (row) => formatSeconds(row.scheduled_seconds),
        tooltip: "Suma únicamente horarios laborales configurados. Sin horario explícito se muestra vacío.",
      },
      {
        id: "disponible",
        header: "Disponible",
        align: "right",
        value: (row) => row.available_seconds,
        cell: (row) => formatSeconds(row.available_seconds),
      },
      {
        id: "pausado",
        header: "Pausado",
        align: "right",
        value: (row) => row.paused_seconds,
        cell: (row) => formatSeconds(row.paused_seconds),
      },
      {
        id: "desconectado",
        header: "Desconectado en jornada",
        align: "right",
        value: (row) => row.disconnected_seconds,
        cell: (row) => formatSeconds(row.disconnected_seconds),
        tooltip: "Sólo el cruce entre Desconectado y un horario laboral explícito. Fuera de jornada no suma.",
      },
      {
        id: "adherencia",
        header: "Adherencia",
        align: "right",
        metric: "adherencia",
        value: (row) => row.adherence_rate,
        cell: (row) => formatPercent(row.adherence_rate),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-1.5">
          {RANGE_PRESETS.map((preset) => {
            const range = rangeFor(preset.days);
            const active = from === range.from && to === range.to;
            return (
              <Button
                key={preset.id}
                variant={active ? "primary" : "secondary"}
                size="sm"
                onClick={() => applyRange(range)}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>

        <Field label="Desde" className="w-auto">
          <Input type="date" value={pendingFrom} onChange={(event) => setPendingFrom(event.target.value)} />
        </Field>
        <Field label="Hasta" className="w-auto">
          <Input type="date" value={pendingTo} onChange={(event) => setPendingTo(event.target.value)} />
        </Field>
        <Field label="Campaña" className="w-auto">
          <Select
            value={campaignId}
            onChange={(event) => {
              setLoading(true);
              setCampaignId(event.target.value);
            }}
          >
            <option value="">Todas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>

        <Button onClick={() => applyRange({ from: pendingFrom, to: pendingTo })}>Aplicar</Button>
        {loading && <LoadingState label="Actualizando el reporte" compact />}
      </Card>

      {error && (
        <Card className="flex items-center gap-3">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
            Reintentar
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard label="Intentos" value={totals.total_attempts.toLocaleString("es-CL")} />
        <MetricCard label="Contestadas" value={totals.answered.toLocaleString("es-CL")} tone="good" />
        <MetricCard label="Completadas" value={totals.completed.toLocaleString("es-CL")} />
        <MetricCard label="No contesta" value={totals.no_answer.toLocaleString("es-CL")} />
        <MetricCard
          label="Abandono"
          metric="abandono"
          value={abandonRate != null ? formatPercent(abandonRate) : "—"}
          hint={`${totals.abandoned.toLocaleString("es-CL")} llamadas`}
          target={`≤ ${ABANDON_ALERT_RATE}%`}
          tone={abandonRate != null && abandonRate > ABANDON_ALERT_RATE ? "danger" : "good"}
        />
      </div>

      <SectionCard
        title="Métricas de llamadas"
        description={`Por día y campaña · ${formatDate(from)} a ${formatDate(to)}${
          selectedCampaignName ? ` · ${selectedCampaignName}` : ""
        }`}
      >
        <div className="p-4">
          <DataTable
            rows={callMetrics}
            columns={metricColumns}
            getRowId={(row) => `${row.report_date}-${row.campaign_id}`}
            storageKey="reportes-discador-llamadas"
            exportFilename="metricas-de-llamadas"
            loading={loading}
            loadingLabel="Estamos calculando las métricas de llamadas"
            emptyTitle="Sin llamadas en el rango seleccionado"
            emptyDescription="Prueba con otro período o revisa que la campaña haya tenido discado activo."
          />
        </div>
      </SectionCard>

      <SectionCard
        title={
          <span className="inline-flex items-center gap-1.5">
            Actividad por ejecutivo
            <InfoTooltip text="La jornada se calcula sólo con horarios laborales explícitos. Disponible, AUX y Desconectado se recortan a esos horarios; fuera de jornada no suman. Al filtrar una campaña, estas columnas quedan vacías porque el tiempo operativo no se atribuye a una sola campaña." />
          </span>
        }
        description={
          selectedCampaignName
            ? `${selectedCampaignName} · solo métricas de llamada: el tiempo de jornada no es atribuible a una campaña`
            : "Todas las campañas · jornada completa"
        }
      >
        <div className="p-4">
          <DataTable
            rows={agentActivity}
            columns={activityColumns}
            getRowId={(row) => row.profile_id}
            storageKey="reportes-discador-agentes"
            exportFilename="actividad-por-ejecutivo"
            loading={loading}
            loadingLabel="Estamos preparando la actividad del equipo"
            emptyTitle="Sin actividad en el rango seleccionado"
            emptyDescription="No hay sesiones de ejecutivos registradas en estas fechas."
          />
        </div>
      </SectionCard>
    </div>
  );
}
