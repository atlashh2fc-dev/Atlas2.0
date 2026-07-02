import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AgentPerformance, CampaignDashboardSummary as CampaignDashboardSummaryData, WorkflowCompliance } from "@/lib/types";
import { CampaignDashboardSummary } from "@/components/campaign-dashboard-summary";
import { AgentPerformanceChart, WorkflowComplianceChart } from "@/components/reportes-charts";

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

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const toneClass =
    tone === "good"
      ? "border-success/30"
      : tone === "warn"
        ? "border-warning/40"
        : tone === "danger"
          ? "border-danger/30"
          : "border-border";

  return (
    <div className={`rounded-xl border ${toneClass} bg-surface p-5`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
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
          <MetricCard label="Base equipo" value={formatNumber(kpis.base_total)} detail={`${formatNumber(kpis.asignados)} asignados`} />
          <MetricCard label="Recorridos" value={formatNumber(kpis.recorridos)} detail={`${formatNumber(kpis.sin_asignar)} sin asignar`} />
          <MetricCard
            label="Contactados"
            value={formatNumber(kpis.contactados)}
            detail={`Contactabilidad ${formatPercent(kpis.contactabilidad)}`}
            tone="good"
          />
          <MetricCard label="CRM tipificado" value={formatNumber(kpis.crm_gestiones)} detail={`${formatNumber(kpis.llamadas_cerradas)} llamadas cerradas`} />
          <MetricCard label="No contacto" value={formatNumber(kpis.no_contacto)} detail="No contesta, ocupado, buzón o fuera de servicio" />
          <MetricCard label="Agendas creadas" value={formatNumber(kpis.agendas_creadas)} detail={`${formatNumber(kpis.agendas_pendientes)} pendientes`} />
          <MetricCard
            label="Agendas vencidas"
            value={formatNumber(kpis.agendas_vencidas)}
            detail="Compromisos pendientes de recuperar"
            tone={kpis.agendas_vencidas > 0 ? "danger" : "default"}
          />
          <MetricCard label="TMO" value={formatDuration(kpis.tmo_seconds)} detail="Promedio llamadas cerradas" />
          <MetricCard label="Cotizaciones" value={formatNumber(kpis.cotizaciones)} />
          <MetricCard label="Ventas / validación" value={formatNumber(kpis.ventas)} tone="good" />
          <MetricCard label="UF comercial" value={formatUf(kpis.uf)} />
          <MetricCard label="Ejecutivos reportados" value={formatNumber(report.agents.length)} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Métricas por ejecutivo</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Ejecutivo</th>
                  <th className="px-5 py-3 font-medium">Gestiones</th>
                  <th className="px-5 py-3 font-medium">Leads</th>
                  <th className="px-5 py-3 font-medium">Llamadas</th>
                  <th className="px-5 py-3 font-medium">Contactados</th>
                  <th className="px-5 py-3 font-medium">%</th>
                  <th className="px-5 py-3 font-medium">No contacto</th>
                  <th className="px-5 py-3 font-medium">Agendas</th>
                  <th className="px-5 py-3 font-medium">Cotizaciones</th>
                  <th className="px-5 py-3 font-medium">Ventas</th>
                  <th className="px-5 py-3 font-medium">UF</th>
                  <th className="px-5 py-3 font-medium">TMO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.agents.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-5 py-6 text-center text-muted-foreground">
                      Sin ejecutivos reportados.
                    </td>
                  </tr>
                )}
                {report.agents.map((agent) => (
                  <tr key={agent.agent_id}>
                    <td className="px-5 py-3 font-medium text-foreground">
                      <span>{agent.full_name}</span>
                      {agent.is_historical_only && (
                        <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Histórico
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.crm_gestiones)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.leads_gestionados)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.llamadas_cerradas)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.contactos_efectivos)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatPercent(agent.contactabilidad)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.no_contacto)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.agendas)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.cotizaciones)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatNumber(agent.ventas)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDecimal(agent.uf, 2)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDuration(agent.tmo_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Tipificaciones</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Tipificación</th>
                    <th className="px-5 py-3 text-right font-medium">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.tipifications.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-6 text-center text-muted-foreground">
                        Sin tipificaciones en el período.
                      </td>
                    </tr>
                  )}
                  {report.tipifications.map((row) => (
                    <tr key={row.label}>
                      <td className="px-5 py-3 font-medium text-foreground">{row.label}</td>
                      <td className="px-5 py-3 text-right text-muted-foreground">{formatNumber(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Movimiento diario</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Día</th>
                    <th className="px-5 py-3 font-medium">Gestiones</th>
                    <th className="px-5 py-3 font-medium">Contactados</th>
                    <th className="px-5 py-3 font-medium">Agendas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.daily.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                        Sin movimiento diario en el período.
                      </td>
                    </tr>
                  )}
                  {report.daily.map((row) => (
                    <tr key={row.day}>
                      <td className="px-5 py-3 font-medium text-foreground">{formatDate(row.day)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatNumber(row.crm_gestiones)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatNumber(row.contactos_efectivos)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatNumber(row.agendas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
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
