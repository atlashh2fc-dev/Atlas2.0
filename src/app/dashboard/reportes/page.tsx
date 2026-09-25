import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";
import type {
  CampaignDashboardSummary as CampaignDashboardSummaryData,
  SecretariaVirtualChannelFunnelRow,
} from "@/lib/types";
import { CampaignDashboardSummary, type ContactabilityHour } from "@/components/campaign-dashboard-summary";
import { TipificationBreakdown } from "@/components/tipification-breakdown";
import { groupTipificationsByResult } from "@/lib/tipification-breakdown";
import {
  SupervisorAgentFocusChart,
  SupervisorDailyChart,
  SupervisorPipelineChart,
  SupervisorTipificationsChart,
} from "@/components/reportes-charts";
import { SupervisorAgentMetricsTable } from "@/components/supervisor-agent-metrics-table";
import { ChartDownloadButton } from "@/components/chart-download-button";
import Link from "next/link";
import { Button, buttonClasses, Callout, Card, InfoTooltip, Select } from "@/components/ui";
import { metricDefinition, type MetricId } from "@/lib/metric-definitions";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import {
  fetchCampaignVertical,
  getCampaignVocabulary,
  parseCampaignVertical,
  funnelStageLabel,
} from "@/lib/campaign-vertical";
import { formatReportRangeLabel, resolveReportRange, toDateInput } from "@/lib/report-range";
import { isSecretariaVirtualAuditCampaign } from "@/lib/secretaria-virtual-quality-rubric";

/** Fila de `get_campaign_tipification_breakdown`. */
type CampaignTipificationRow = {
  reason: string;
  status: string | null;
  outcome: string | null;
  declared_result: string | null;
  total: number;
};

type SupervisorReportKpis = {
  base_total: number;
  asignados: number;
  sin_asignar: number;
  recorridos: number;
  vocalcom_recorridos?: number;
  contactados: number;
  vocalcom_contactados?: number;
  contactabilidad: number | null;
  crm_gestiones: number;
  llamadas_cerradas: number;
  /** Llamadas cerradas del período que vienen migradas de Atlas 1. */
  llamadas_atlas1?: number;
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

/**
 * Tarjeta local del tablero de gestión: agrega definición del glosario y enlace
 * al detalle sobre el mismo diseño del sistema.
 */
function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  progress,
  metric,
  href,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warn" | "danger";
  progress?: number;
  metric?: MetricId;
  href?: string;
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

  const definition = metric ? metricDefinition(metric) : null;
  const body = (
    <>
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {definition && <InfoTooltip text={definition.definition} formula={definition.formula} />}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail && <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>}
      {clampedProgress !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clampedProgress}%` }} />
        </div>
      )}
      {href && (
        <span className="mt-2 block text-xs font-medium text-primary">Ver detalle →</span>
      )}
    </>
  );

  const base = `block rounded-lg border ${toneClass} bg-surface p-4 shadow-sm`;
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link href={href} className={`${base} transition-colors hover:bg-surface-muted/50`}>
      {body}
    </Link>
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
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <ChartDownloadButton filename={filename} rows={rows} />
      </div>
      {children}
    </section>
  );
}

/**
 * Descarga «Negocios en curso» de Equifax (la hoja Data de operación). Aparece
 * cuando hay campañas Equifax a la vista; con una campaña elegida baja solo esa.
 * Es un enlace simple: la ruta devuelve el .xlsx como adjunto.
 */
function EquifaxNegociosDownload({
  campaigns,
  selectedId,
}: {
  campaigns: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? null;
  const equifax = campaigns.filter((campaign) => /equifax/i.test(campaign.name));
  if (equifax.length === 0 || (selected && !/equifax/i.test(selected.name))) return null;
  const href = selected
    ? `/api/reportes/equifax-negocios?campaign=${encodeURIComponent(selected.id)}`
    : "/api/reportes/equifax-negocios";
  return (
    <a
      href={href}
      download
      className={buttonClasses({ variant: "secondary" })}
      title="Una fila por negocio con cotización o venta: las columnas de la hoja Data de operación"
    >
      Descargar negocios Equifax (Excel)
    </a>
  );
}

/**
 * Filtro de campaña del reporte. Navega por GET y conserva el período: sin los
 * campos ocultos, cambiar de campaña volvía al período por defecto.
 */
function CampaignFilter({
  campaigns,
  selectedId,
  range,
  allLabel = "Todas las campañas",
}: {
  campaigns: { id: string; name: string }[];
  selectedId: string | null;
  range: ReturnType<typeof resolveReportRange>;
  allLabel?: string;
}) {
  return (
    <form className="flex items-center gap-2">
      <input type="hidden" name="preset" value={range.preset} />
      {range.preset === "custom" && (
        <>
          <input type="hidden" name="from" value={toDateInput(range.from)} />
          <input type="hidden" name="to" value={toDateInput(range.to)} />
        </>
      )}
      <Select name="campaign" defaultValue={selectedId ?? ""} className="w-auto" aria-label="Campaña">
        <option value="">{allLabel}</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </Select>
      <Button type="submit">Ver</Button>
    </form>
  );
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; preset?: string; from?: string; to?: string }>;
}) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { campaign: campaignParam, preset, from, to } = await searchParams;
  const campaignScope = resolveCampaignScope(campaignParam);
  const supabase = await createClient();
  // El período llega por la URL desde el selector del layout; ya no hay una
  // ventana fija de 30 días decidida acá.
  const range = resolveReportRange({ preset, from, to });
  const dashboardFrom = range.from;
  const dashboardTo = range.to;

  if (profile.role === "supervisor") {
    // El vocabulario del reporte lo decide la campaña, no el rol: una cartera
    // de cobranza no cierra ventas ni envía cotizaciones.
    const vertical = await fetchCampaignVertical(supabase, campaignScope || null);
    const vocabulary = getCampaignVocabulary(vertical);
    const [{ data, error }, { data: campaignRows }, { data: breakdownRows }] = await Promise.all([
      supabase.rpc("get_supervisor_report_summary", {
        p_from: dashboardFrom.toISOString(),
        p_to: dashboardTo.toISOString(),
        p_team_id: null,
        p_campaign_id: campaignScope || null,
      }),
      supabase.rpc("get_report_scope_campaigns"),
      // El mismo desglose por resultado que ve el admin. Es SECURITY INVOKER:
      // la seguridad por fila de calls y leads lo acota a los equipos del
      // supervisor. Si falla, el reporte sigue y el panel queda vacío.
      supabase.rpc("get_campaign_tipification_breakdown", {
        p_from: dashboardFrom.toISOString(),
        p_to: dashboardTo.toISOString(),
        p_campaign_id: campaignScope || null,
      }),
    ]);

    // La RPC levanta excepciones de negocio legibles ("tu supervisor no tiene
    // equipos asignados"). Relanzarlas dejaba la pantalla en negro con un
    // "server error" que no dice nada y parece una caída del sitio.
    if (error) {
      return (
        <Callout tone="warning">
          <p className="font-medium">No se pudo armar tu reporte.</p>
          <p className="mt-1">{error.message}</p>
          <p className="mt-2 text-xs">
            Si el mensaje habla de equipos, un administrador tiene que asignarte equipos en
            ⚙ Configuración → Usuarios y equipos.
          </p>
        </Callout>
      );
    }

    const report = data as SupervisorReportSummary;
    const campaigns = (campaignRows ?? []) as { id: string; name: string }[];
    const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignScope) ?? null;
    const campaignQuery = selectedCampaign ? `?campaign=${encodeURIComponent(selectedCampaign.id)}` : "";
    const kpis = report.kpis;
    const tipificationsByResult = groupTipificationsByResult(
      ((breakdownRows ?? []) as CampaignTipificationRow[]).map((row) => ({
        reason: row.reason,
        count: row.total,
        status: row.status,
        outcome: row.outcome,
        declaredResult: row.declared_result,
      })),
    );
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
      { Etapa: funnelStageLabel(vocabulary, "Base"), Cantidad: kpis.base_total },
      { Etapa: funnelStageLabel(vocabulary, "Recorridos"), Cantidad: kpis.recorridos },
      { Etapa: funnelStageLabel(vocabulary, "Contactados"), Cantidad: kpis.contactados },
      { Etapa: funnelStageLabel(vocabulary, "CRM tipificado"), Cantidad: kpis.crm_gestiones },
      { Etapa: funnelStageLabel(vocabulary, "Cotizaciones"), Cantidad: kpis.cotizaciones },
      { Etapa: funnelStageLabel(vocabulary, "Ventas"), Cantidad: kpis.ventas },
    ];
    const agentFocusRows = report.agents.map((agent) => ({
      Ejecutivo: agent.full_name,
      Equipo: agent.team_name,
      Gestiones: agent.crm_gestiones,
      Contactados: agent.contactos_efectivos,
      "No contacto": agent.no_contacto,
      Agendas: agent.agendas,
      [vocabulary.kpi.intermedio]: agent.cotizaciones,
      [vocabulary.kpi.cierreNota]: agent.ventas,
      Contactabilidad: agent.contactabilidad,
    }));

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {`${selectedCampaign ? `${selectedCampaign.name} · ` : "Todos tus equipos · "}${formatReportRangeLabel(range)}`}
            </p>
            {range.notice && <p className="text-sm text-warning">{range.notice}</p>}
          </div>
          {/* El selector del encabezado se perdió el 10-09 y el supervisor quedó
              sin forma de elegir campaña: el filtro vive en la página, igual
              que para el admin. Solo lista las campañas de su alcance. */}
          <div className="flex flex-wrap items-center gap-2">
            <EquifaxNegociosDownload campaigns={campaigns} selectedId={selectedCampaign?.id ?? null} />
            {campaigns.length > 0 && (
              <CampaignFilter
                campaigns={campaigns}
                selectedId={selectedCampaign?.id ?? null}
                range={range}
                allLabel="Todas mis campañas"
              />
            )}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={vocabulary.base}
            href={`/dashboard/leads${campaignQuery}`}
            value={formatNumber(kpis.base_total)}
            detail={`${formatNumber(kpis.asignados)} asignados`}
            progress={percent(kpis.asignados, kpis.base_total)}
          />
          <MetricCard
            label="Recorridos"
            value={formatNumber(kpis.recorridos)}
            detail={`${formatNumber(kpis.vocalcom_recorridos)} desde Vocalcom`}
            progress={percent(kpis.recorridos, kpis.base_total)}
          />
          <MetricCard
            label="Contactados"
            metric="contactabilidad"
            href={`/dashboard/leads?view=gestionados${selectedCampaign ? `&campaign=${encodeURIComponent(selectedCampaign.id)}` : ""}`}
            value={formatNumber(kpis.contactados)}
            detail={`Contactabilidad ${formatPercent(kpis.contactabilidad)} · ${formatNumber(kpis.vocalcom_contactados)} Vocalcom`}
            tone="good"
            progress={kpis.contactabilidad ?? 0}
          />
          <MetricCard
            label={vocabulary.kpi.gestiones}
            value={formatNumber(kpis.crm_gestiones)}
            detail={
              kpis.llamadas_atlas1
                ? `${formatNumber(kpis.llamadas_cerradas)} llamadas cerradas · ${formatNumber(kpis.llamadas_atlas1)} del historial de Atlas 1`
                : `${formatNumber(kpis.llamadas_cerradas)} llamadas cerradas`
            }
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
            label={vocabulary.kpi.agendas}
            href={`/dashboard/leads?view=hoy${selectedCampaign ? `&campaign=${encodeURIComponent(selectedCampaign.id)}` : ""}`}
            value={formatNumber(kpis.agendas_creadas)}
            detail={`${formatNumber(kpis.agendas_pendientes)} pendientes`}
            progress={percent(kpis.agendas_pendientes, kpis.agendas_creadas)}
          />
          <MetricCard
            label={vocabulary.kpi.agendasVencidas}
            href={`/dashboard/leads?view=vencidas${selectedCampaign ? `&campaign=${encodeURIComponent(selectedCampaign.id)}` : ""}`}
            value={formatNumber(kpis.agendas_vencidas)}
            detail={vocabulary.kpi.agendasVencidasDetalle}
            tone={kpis.agendas_vencidas > 0 ? "danger" : "default"}
            progress={percent(kpis.agendas_vencidas, kpis.agendas_creadas)}
          />
          <MetricCard
            label="TMO"
            metric="tmo"
            value={formatDuration(kpis.tmo_seconds)}
            detail="Promedio de llamadas cerradas"
          />
          <MetricCard
            label={vocabulary.kpi.intermedio}
            value={formatNumber(kpis.cotizaciones)}
            progress={percent(kpis.cotizaciones, kpis.contactados)}
          />
          <MetricCard
            label={vocabulary.kpi.cierre}
            value={formatNumber(kpis.ventas)}
            tone="good"
            progress={percent(kpis.ventas, kpis.cotizaciones)}
          />
          <MetricCard
            label={vertical === "cobranza" ? vocabulary.kpi.monto : "UF comercial"}
            metric="uf"
            value={formatUf(kpis.uf)}
          />
          <MetricCard label="Ejecutivos reportados" value={formatNumber(report.agents.length)} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Métricas por ejecutivo</h2>
          <SupervisorAgentMetricsTable
            agents={report.agents}
            rangeFrom={report.range.from}
            rangeTo={report.range.to}
            campaignId={selectedCampaign?.id}
            vertical={vertical}
          />
        </section>

        <TipificationBreakdown breakdown={tipificationsByResult} title={vocabulary.motivosTitle} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartPanel title={vocabulary.tipificacionesTitle} filename="tipificaciones-equipo.xlsx" rows={tipificationRows}>
            <SupervisorTipificationsChart tipifications={report.tipifications} />
          </ChartPanel>

          <ChartPanel title="Movimiento diario" filename="movimiento-diario-equipo.xlsx" rows={dailyRows}>
            <SupervisorDailyChart daily={report.daily} />
          </ChartPanel>

          <ChartPanel
            title={vertical === "cobranza" ? "Embudo de recuperación" : "Embudo operativo"}
            filename="embudo-operativo-equipo.xlsx"
            rows={pipelineRows}
          >
            <SupervisorPipelineChart kpis={kpis} />
          </ChartPanel>

          <ChartPanel title="Foco por ejecutivo · top 10" filename="foco-ejecutivo-equipo.xlsx" rows={agentFocusRows}>
            <SupervisorAgentFocusChart agents={report.agents} />
          </ChartPanel>
        </div>
      </div>
    );
  }

  const { data: campaignList } = await supabase.from("campaigns").select("id, name, vertical").order("name");
  const campaigns = (campaignList ?? []) as { id: string; name: string; vertical?: string | null }[];
  const selectedCampaignId = campaigns.some((campaign) => campaign.id === campaignScope) ? campaignScope : null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;
  // Sin campaña elegida el tablero mezcla verticales, así que se queda con el
  // vocabulario comercial, que es el común a todas.
  const adminVertical = parseCampaignVertical(selectedCampaign?.vertical);
  let dashboardSummary: CampaignDashboardSummaryData | null = null;
  const showChannelFunnel =
    selectedCampaign !== null && isSecretariaVirtualAuditCampaign(selectedCampaign.name);

  const [hourlyResult, summaryResult, channelFunnelResult, tipificationResult] = await Promise.all([
    supabase.rpc("get_contactability_by_hour", {
      p_from: dashboardFrom.toISOString(),
      p_to: dashboardTo.toISOString(),
      p_campaign_id: selectedCampaignId,
    }),
    supabase.rpc("get_crm_dashboard_summary", {
      p_from: dashboardFrom.toISOString(),
      p_to: dashboardTo.toISOString(),
      // El comparativo sigue al período elegido: antes restaba 30 días siempre,
      // así que cualquier otra ventana habría comparado contra un tramo ajeno.
      p_previous_from: range.previousFrom.toISOString(),
      p_previous_to: range.previousTo.toISOString(),
      p_campaign_id: selectedCampaignId,
    }),
    showChannelFunnel
      ? supabase.rpc("get_secretaria_virtual_channel_funnel", {
          p_from: dashboardFrom.toISOString(),
          p_to: dashboardTo.toISOString(),
        })
      : Promise.resolve({ data: null, error: null }),
    // Trae el estado y el desenlace que dejó grabado cada cierre. Es lo que
    // permite clasificar las tipificaciones de una campaña con workflow propio,
    // que el resumen no distingue porque sólo devuelve el motivo.
    supabase.rpc("get_campaign_tipification_breakdown", {
      p_from: dashboardFrom.toISOString(),
      p_to: dashboardTo.toISOString(),
      p_campaign_id: selectedCampaignId,
    }),
  ]);
  const { data: hourlyData } = hourlyResult;
  const { data, error } = summaryResult;

  if (error) {
    return (
      <Callout tone="warning">
        <p className="font-medium">No se pudo armar el reporte.</p>
        <p className="mt-1">{error.message}</p>
      </Callout>
    );
  }
  dashboardSummary = data as CampaignDashboardSummaryData;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {selectedCampaign
              ? `${selectedCampaign.name} · ${adminVertical === "cobranza" ? "KPIs, embudo de recuperación y seguimiento de la cartera." : "KPIs, embudo y seguimiento de la campaña."}`
              : "Todas las campañas · KPIs consolidados."}
          </p>
          {range.notice && <p className="text-sm text-warning">{range.notice}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EquifaxNegociosDownload campaigns={campaigns} selectedId={selectedCampaignId} />
          {campaigns.length > 0 && (
            <CampaignFilter campaigns={campaigns} selectedId={selectedCampaignId} range={range} />
          )}
        </div>
      </div>

      {campaigns.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No hay campañas configuradas.
        </Card>
      )}

      {dashboardSummary && (
        <CampaignDashboardSummary
          key={selectedCampaignId ?? "all"}
          summary={dashboardSummary}
          hourly={(hourlyData ?? []) as ContactabilityHour[]}
          vertical={adminVertical}
          channelFunnel={
            showChannelFunnel
              ? ((channelFunnelResult.data ?? []) as SecretariaVirtualChannelFunnelRow[])
              : undefined
          }
          tipificationRows={
            ((tipificationResult.data ?? []) as CampaignTipificationRow[]).map((row) => ({
              reason: row.reason,
              count: row.total,
              status: row.status,
              outcome: row.outcome,
              declaredResult: row.declared_result,
            }))
          }
        />
      )}
    </div>
  );
}
