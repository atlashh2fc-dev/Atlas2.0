import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";
import type { AgentPerformance, CampaignDashboardSummary as CampaignDashboardSummaryData, WorkflowCompliance } from "@/lib/types";
import { CampaignDashboardSummary } from "@/components/campaign-dashboard-summary";
import {
  AgentPerformanceChart,
  SupervisorAgentFocusChart,
  SupervisorDailyChart,
  SupervisorPipelineChart,
  SupervisorTipificationsChart,
  WorkflowComplianceChart,
} from "@/components/reportes-charts";
import { SupervisorAgentMetricsTable } from "@/components/supervisor-agent-metrics-table";
import { ChartDownloadButton } from "@/components/chart-download-button";

type SupervisorReportKpis = {
  base_total: number;
  asignados: number;
  sin_asignar: number;
  recorridos: number;
  contactados: number;
  contactabilidad: number | null;
  crm_gestiones: number;
  llamadas_cerradas: number;
  no_contacto: number;
  agendas_creadas: number;
  agendas_vencidas: number;
  agendas_pendientes: number;
  cotizaciones: number;
  ventas: number;
  uf: number;
  tmo_seconds: number | null;
};

type SupervisorReportAgent = {
  agent_id: string;
  profile_id?: string | null;
  historical_agent_id?: string | null;
  full_name: string;
  team_name: string | null;
  is_historical_only?: boolean;
  crm_gestiones: number;
  llamadas_cerradas: number;
  leads_gestionados: number;
  contactos_efectivos: number;
  contactabilidad: number | null;
  no_contacto: number;
  agendas: number;
  cotizaciones: number;
  ventas: number;
  uf: number;
  tmo_seconds: number | null;
};

type SupervisorReportSummary = {
  range: {
    from: string;
    to: string;
    team_id: string | null;
  };
  kpis: SupervisorReportKpis;
  agents: SupervisorReportAgent[];
  tipifications: { label: string; count: number }[];
  daily: {
    day: string;
    crm_gestiones: number;
    contactos_efectivos: number;
    agendas: number;
  }[];
};

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatNumber(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)).toLocaleString("es-CL");
}

function formatDecimal(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("es-CL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${formatDecimal(value)}%`;
}

function formatUf(value: number | null | undefined) {
  return `UF ${formatDecimal(value, 2)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
}

function percent(part: number | null | undefined, total: number | null | undefined): number {
  const denominator = Number(total ?? 0);
  if (denominator <= 0) return 0;
  return (Number(part ?? 0) / denominator) * 100;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  progress,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warn" | "danger";
  progress?: number;
}) {
  const toneClass =
    tone === "good"
      ? "border-success/30"
      : tone === "warn"
        ? "border-warning/40"
        : tone === "danger"
          ? "border-danger/30"
          : "border-border";
  const clampedProgress =
    typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const barClass =
    tone === "good"
      ? "bg-success"
      : tone === "warn"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-danger"
          : "bg-primary";

  return (
    <div className={`rounded-xl border ${toneClass} bg-surface p-5`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
      {clampedProgress !== null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clampedProgress}%` }} />
        </div>
      )}
    </div>
  );
}

function ChartPanel({
  title,
  filename,
  rows,
  children,
}: {
  title: string;
  filename: string;
  rows: Record<string, string | number | null | undefined>[];
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <ChartDownloadButton filename={filename} rows={rows} />
      </div>
      {children}
    </section>
  );
}

const DASHBOARD_WINDOW_DAYS = 30;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { campaign: campaignParam } = await searchParams;
  const supabase = await createClient();
  const dashboardTo = endOfDay(new Date());
  const dashboardFrom = startOfDay(addDays(dashboardTo, -(DASHBOARD_WINDOW_DAYS - 1)));

  if (profile.role === "supervisor") {
    const { data, error } = await supabase.rpc("get_supervisor_report_summary", {
      p_from: dashboardFrom.toISOString(),
      p_to: dashboardTo.toISOString(),
      p_team_id: null,
    });

    if (error) throw new Error(error.message);

    const report = data as SupervisorReportSummary;
    const kpis = report.kpis;
    const tipificationRows = report.tipifications.map((row) => ({
      Tipificación: row.label,
      Cantidad: row.count,
    }));
    const dailyRows = report.daily.map((row) => ({
      Día: formatDate(row.day),
      Gestiones: row.crm_gestiones,
      Contactados: row.contactos_efectivos,
      Agendas: row.agendas,
    }));
    const pipelineRows = [
      { Etapa: "Base", Cantidad: kpis.base_total },
      { Etapa: "Recorridos", Cantidad: kpis.recorridos },
      { Etapa: "Contactados", Cantidad: kpis.contactados },
      { Etapa: "CRM tipificado", Cantidad: kpis.crm_gestiones },
      { Etapa: "Cotizaciones", Cantidad: kpis.cotizaciones },
      { Etapa: "Ventas", Cantidad: kpis.ventas },
    ];
    const agentFocusRows = report.agents.map((agent) => ({
      Ejecutivo: agent.full_name,
      Equipo: agent.team_name,
      Gestiones: agent.crm_gestiones,
      Contactados: agent.contactos_efectivos,
      "No contacto": agent.no_contacto,
      Agendas: agent.agendas,
      Cotizaciones: agent.cotizaciones,
      Ventas: agent.ventas,
      Contactabilidad: agent.contactabilidad,
    }));

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Reportes del equipo</h1>
            <p className="text-sm text-muted-foreground">
              Últimos {DASHBOARD_WINDOW_DAYS} días · {formatDate(report.range.from)} a {formatDate(report.range.to)}
            </p>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Base equipo"
            value={formatNumber(kpis.base_total)}
            detail={`${formatNumber(kpis.asignados)} asignados`}
            progress={percent(kpis.asignados, kpis.base_total)}
          />
          <MetricCard
            label="Recorridos"
            value={formatNumber(kpis.recorridos)}
            detail={`${formatNumber(kpis.sin_asignar)} sin asignar`}
            progress={percent(kpis.recorridos, kpis.base_total)}
          />
          <MetricCard
            label="Contactados"
            value={formatNumber(kpis.contactados)}
            detail={`Contactabilidad ${formatPercent(kpis.contactabilidad)}`}
            tone="good"
            progress={kpis.contactabilidad ?? 0}
          />
          <MetricCard
            label="CRM tipificado"
            value={formatNumber(kpis.crm_gestiones)}
            detail={`${formatNumber(kpis.llamadas_cerradas)} llamadas cerradas`}
            progress={percent(kpis.crm_gestiones, kpis.llamadas_cerradas)}
          />
          <MetricCard
            label="No contacto"
            value={formatNumber(kpis.no_contacto)}
            detail="No contesta, ocupado, buzón o fuera de servicio"
            progress={percent(kpis.no_contacto, kpis.llamadas_cerradas)}
            tone="warn"
          />
          <MetricCard
            label="Agendas creadas"
            value={formatNumber(kpis.agendas_creadas)}
            detail={`${formatNumber(kpis.agendas_pendientes)} pendientes`}
            progress={percent(kpis.agendas_pendientes, kpis.agendas_creadas)}
          />
          <MetricCard
            label="Agendas vencidas"
            value={formatNumber(kpis.agendas_vencidas)}
            detail="Compromisos pendientes de recuperar"
            tone={kpis.agendas_vencidas > 0 ? "danger" : "default"}
            progress={percent(kpis.agendas_vencidas, kpis.agendas_creadas)}
          />
          <MetricCard label="TMO" value={formatDuration(kpis.tmo_seconds)} detail="Promedio llamadas cerradas" />
          <MetricCard
            label="Cotizaciones"
            value={formatNumber(kpis.cotizaciones)}
            progress={percent(kpis.cotizaciones, kpis.contactados)}
          />
          <MetricCard
            label="Ventas / validación"
            value={formatNumber(kpis.ventas)}
            tone="good"
            progress={percent(kpis.ventas, kpis.cotizaciones)}
          />
          <MetricCard label="UF comercial" value={formatUf(kpis.uf)} />
          <MetricCard label="Ejecutivos reportados" value={formatNumber(report.agents.length)} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Métricas por ejecutivo</h2>
          <SupervisorAgentMetricsTable agents={report.agents} rangeFrom={report.range.from} rangeTo={report.range.to} />
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartPanel title="Tipificaciones" filename="tipificaciones-equipo.xlsx" rows={tipificationRows}>
            <SupervisorTipificationsChart tipifications={report.tipifications} />
          </ChartPanel>

          <ChartPanel title="Movimiento diario" filename="movimiento-diario-equipo.xlsx" rows={dailyRows}>
            <SupervisorDailyChart daily={report.daily} />
          </ChartPanel>

          <ChartPanel title="Embudo operativo" filename="embudo-operativo-equipo.xlsx" rows={pipelineRows}>
            <SupervisorPipelineChart kpis={kpis} />
          </ChartPanel>

          <ChartPanel title="Foco por ejecutivo" filename="foco-ejecutivo-equipo.xlsx" rows={agentFocusRows}>
            <SupervisorAgentFocusChart agents={report.agents} />
          </ChartPanel>
        </div>
      </div>
    );
  }

  const agentPerfQuery = supabase
    .from("agent_performance")
    .select("*")
    .order("total_interactions", { ascending: false });
  const { data: agentPerf } = await agentPerfQuery;

  const { data: workflowCompliance } = await supabase.rpc("get_workflow_compliance");

  const { data: campaignList } = await supabase.from("campaigns").select("id, name").order("name");

  const agents = (agentPerf ?? []) as AgentPerformance[];
  const workflows = (workflowCompliance ?? []) as WorkflowCompliance[];
  const campaigns = campaignList ?? [];

  const selectedCampaignId = campaignParam || campaigns[0]?.id || null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;
  const loadedFrom = startOfDay(addDays(dashboardFrom, -DASHBOARD_WINDOW_DAYS));
  const previousTo = new Date(dashboardFrom.getTime() - 1);

  let dashboardSummary: CampaignDashboardSummaryData | null = null;

  if (selectedCampaignId) {
    const { data, error } = await supabase.rpc("get_campaign_dashboard_summary", {
      p_campaign_id: selectedCampaignId,
      p_from: dashboardFrom.toISOString(),
      p_to: dashboardTo.toISOString(),
      p_previous_from: loadedFrom.toISOString(),
      p_previous_to: previousTo.toISOString(),
    });

    if (error) throw new Error(error.message);
    dashboardSummary = data as CampaignDashboardSummaryData;
  }

  const totals = agents.reduce(
    (acc, a) => {
      acc.interactions += a.total_interactions;
      acc.leads += a.leads_managed;
      acc.conversions += a.conversions;
      return acc;
    },
    { interactions: 0, leads: 0, conversions: 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Rendimiento por ejecutivo y cumplimiento de flujos de gestión.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Gestiones totales</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.interactions}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Leads gestionados</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.leads}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Conversiones</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.conversions}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Rendimiento por ejecutivo</h2>
        <div className="mb-4 rounded-xl border border-border bg-surface p-5">
          <AgentPerformanceChart agents={agents} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Ejecutivo</th>
                <th className="px-5 py-3 font-medium">Equipo</th>
                <th className="px-5 py-3 font-medium">Gestiones</th>
                <th className="px-5 py-3 font-medium">Leads gestionados</th>
                <th className="px-5 py-3 font-medium">Conversiones</th>
                <th className="px-5 py-3 font-medium">Tiempo prom. 1ra gestión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                    Sin datos todavía.
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.agent_id}>
                  <td className="px-5 py-3 font-medium text-foreground">{a.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.team_name ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.total_interactions}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.leads_managed}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.conversions}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {formatDuration(a.avg_first_response_seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Cumplimiento de flujos</h2>
        <div className="mb-4 rounded-xl border border-border bg-surface p-5">
          <WorkflowComplianceChart workflows={workflows} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Flujo</th>
                <th className="px-5 py-3 font-medium">Leads asignados</th>
                <th className="px-5 py-3 font-medium">Cumplimiento completo</th>
                <th className="px-5 py-3 font-medium">% cumplimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workflows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                    No hay flujos configurados.
                  </td>
                </tr>
              )}
              {workflows.map((w) => (
                <tr key={w.workflow_id}>
                  <td className="px-5 py-3 font-medium text-foreground">{w.workflow_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{w.total_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">{w.compliant_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {w.compliance_rate !== null ? `${w.compliance_rate}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Dashboard de campaña</h2>
          {campaigns.length > 0 && (
            <form className="flex items-center gap-2">
              <select
                name="campaign"
                defaultValue={selectedCampaignId ?? ""}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Ver
              </button>
            </form>
          )}
        </div>

        {campaigns.length === 0 && (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            No hay campañas configuradas.
          </div>
        )}

        {selectedCampaign && dashboardSummary && <CampaignDashboardSummary key={selectedCampaign.id} summary={dashboardSummary} />}
      </div>
    </div>
  );
}
