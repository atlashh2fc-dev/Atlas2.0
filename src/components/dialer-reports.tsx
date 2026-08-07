"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getAgentActivityReport,
  getCallMetricsReport,
  listCampaignsForReports,
} from "@/app/actions/dialer-reports";
import type { AgentActivityReportRow, CallMetricsReportRow } from "@/lib/types";
import {
  Button,
  Callout,
  Card,
  DataTable,
  Field,
  InfoTooltip,
  LoadingState,
  MetricCard,
  SectionCard,
  Select,
  type Column,
} from "@/components/ui";
import { formatReportRangeLabel, resolveReportRange, toDateInput } from "@/lib/report-range";
import {
  CAMPAIGN_DIRECTION_LABELS,
  metricAppliesTo,
  type CampaignDirection,
  type MetricId,
} from "@/lib/metric-definitions";
import type { ReportCampaign } from "@/app/actions/dialer-reports";

const ABANDON_ALERT_RATE = 6;

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
  // El período lo fija el selector del layout de Reportes y viaja por la URL,
  // así el rango se conserva al saltar entre Gestión y Discador. Antes vivía en
  // el estado de este componente y se perdía en cada cambio de pestaña.
  const searchParams = useSearchParams();
  const range = resolveReportRange({
    preset: searchParams.get("preset") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const from = toDateInput(range.from);
  const to = toDateInput(range.to);
  const [campaignId, setCampaignId] = useState<string>("");
  const [campaigns, setCampaigns] = useState<ReportCampaign[]>([]);
  const [callMetrics, setCallMetrics] = useState<CallMetricsReportRow[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId) ?? null;
  const selectedCampaignName = selectedCampaign?.name ?? null;
  // Sin campaña elegida se muestran todas las columnas: el consolidado puede
  // mezclar direcciones y ocultar una familia escondería datos reales.
  const direction: CampaignDirection = selectedCampaign?.direction ?? "blending";

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

  const metricColumns = useMemo<Column<CallMetricsReportRow>[]>(() => {
    const columns: Column<CallMetricsReportRow>[] = [
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
    ];

    // En una campaña saliente no hay cola donde esperar: el nivel de servicio a
    // 20 s y la espera promedio no tienen sujeto y solo inducen a error.
    return columns.filter((column) => {
      const metricId = (column as { metric?: MetricId }).metric;
      return !metricId || metricAppliesTo(metricId, direction);
    });
  }, [direction]);

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
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">Período analizado</span>
          <span className="text-sm font-semibold text-foreground">{formatReportRangeLabel(range)}</span>
        </div>

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
                {campaign.name} · {CAMPAIGN_DIRECTION_LABELS[campaign.direction]}
              </option>
            ))}
          </Select>
        </Field>

        {selectedCampaign && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">Dirección</span>
            <span className="text-sm font-semibold text-foreground">
              {CAMPAIGN_DIRECTION_LABELS[selectedCampaign.direction]}
            </span>
          </div>
        )}

        {loading && <LoadingState label="Actualizando el reporte" compact />}
      </Card>

      {direction === "outbound" && (
        <Callout tone="info">
          Campaña saliente: no se muestran nivel de servicio ni espera en cola, porque en discado
          saliente nadie espera a ser atendido. El abandono acá mide sobremarcación del discador —
          llamadas conectadas sin ejecutivo libre—, no calidad de atención.
        </Callout>
      )}

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
