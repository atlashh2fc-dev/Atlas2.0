import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";
import { StatCard } from "@/components/stat-card";
import Link from "next/link";
import type { AgentPerformance, HomeDashboardSummary, Profile } from "@/lib/types";

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

function firstName(profile: Profile): string {
  return profile.full_name.split(" ")[0] ?? profile.full_name;
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  if (profile.role === "supervisor") {
    const teamId = profile.team_id;
    const today = new Date();
    const nowIso = today.toISOString();
    const todayStart = startOfDay(today).toISOString();
    const todayEnd = endOfDay(today).toISOString();

    const [
      agentsResult,
      totalLeadsResult,
      unassignedResult,
      overdueResult,
      todayResult,
      performanceResult,
    ] = teamId
      ? await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId)
            .eq("role", "agente"),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId)
            .is("assigned_to", null),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId)
            .not("next_action_at", "is", null)
            .lt("next_action_at", nowIso),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId)
            .gte("next_action_at", todayStart)
            .lte("next_action_at", todayEnd),
          supabase
            .from("agent_performance")
            .select("*")
            .eq("team_id", teamId)
            .order("total_interactions", { ascending: false })
            .limit(5),
        ])
      : [
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { data: [] },
        ];

    const topAgents = (performanceResult.data ?? []) as AgentPerformance[];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Control de equipo</h1>
            <p className="text-sm text-muted-foreground">
              Foco diario: carga, agendas vencidas y rendimiento de tus ejecutivos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/team"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Reasignar trabajo
            </Link>
            <Link
              href="/dashboard/reportes"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              Ver reportes
            </Link>
          </div>
        </div>

        {!teamId && (
          <div className="rounded-xl border border-danger/30 bg-danger-bg px-5 py-4 text-sm text-danger">
            Tu usuario supervisor no tiene equipo asignado. Un administrador debe asociarte a un equipo.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Ejecutivos" value={agentsResult.count ?? 0} />
          <StatCard label="Leads del equipo" value={totalLeadsResult.count ?? 0} />
          <StatCard label="Sin asignar" value={unassignedResult.count ?? 0} />
          <StatCard label="Agendas vencidas" value={overdueResult.count ?? 0} />
          <StatCard label="Agendas hoy" value={todayResult.count ?? 0} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5 xl:col-span-2">
            <h2 className="text-sm font-semibold text-foreground">Alertas operativas</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Link
                href="/dashboard/team"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Corregir vencidas</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{overdueResult.count ?? 0}</p>
              </Link>
              <Link
                href="/dashboard/team"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Asignar pendientes</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{unassignedResult.count ?? 0}</p>
              </Link>
              <Link
                href="/dashboard/leads/nuevo"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Registro manual</p>
                <p className="mt-1 text-lg font-semibold text-foreground">Nuevo registro</p>
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Top ejecutivos</h2>
            </div>
            <ul className="divide-y divide-border">
              {topAgents.length === 0 && (
                <li className="px-5 py-4 text-sm text-muted-foreground">Sin gestiones registradas.</li>
              )}
              {topAgents.map((agent) => (
                <li key={agent.agent_id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{agent.full_name}</p>
                    <p className="text-xs text-muted-foreground">{agent.leads_managed} leads gestionados</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{agent.total_interactions}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (profile.role === "admin") {
    const [
      activeUsersResult,
      activeCampaignsResult,
      unassignedLeadsResult,
      campaignsResult,
      campaignAgentsResult,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("assigned_to", null),
      supabase
        .from("campaigns")
        .select("id, name, workflow_id, is_active")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase.from("campaign_agents").select("campaign_id"),
    ]);

    const campaigns = campaignsResult.data ?? [];
    const assignedCampaignIds = new Set((campaignAgentsResult.data ?? []).map((row) => row.campaign_id));
    const campaignsWithoutWorkflow = campaigns.filter((campaign) => campaign.is_active && !campaign.workflow_id);
    const campaignsWithoutAgents = campaigns.filter(
      (campaign) => campaign.is_active && !assignedCampaignIds.has(campaign.id)
    );

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Administración Atlas</h1>
            <p className="text-sm text-muted-foreground">
              Salud del sistema, configuración comercial y calidad de operación.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/admin/campanas"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Configurar campañas
            </Link>
            <Link
              href="/dashboard/admin/usuarios"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              Usuarios y equipos
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Usuarios activos" value={activeUsersResult.count ?? 0} />
          <StatCard label="Campañas activas" value={activeCampaignsResult.count ?? 0} />
          <StatCard label="Leads sin asignar" value={unassignedLeadsResult.count ?? 0} />
          <StatCard label="Campañas sin flujo" value={campaignsWithoutWorkflow.length} />
          <StatCard label="Campañas sin ejecutivos" value={campaignsWithoutAgents.length} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5 xl:col-span-2">
            <h2 className="text-sm font-semibold text-foreground">Pendientes de configuración</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Link
                href="/dashboard/admin/flujos"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Flujos faltantes</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{campaignsWithoutWorkflow.length}</p>
              </Link>
              <Link
                href="/dashboard/admin/campanas"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Sin ejecutivos</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{campaignsWithoutAgents.length}</p>
              </Link>
              <Link
                href="/dashboard/leads/cargar"
                className="rounded-lg border border-border bg-background p-4 hover:bg-surface-muted"
              >
                <p className="text-xs text-muted-foreground">Importación</p>
                <p className="mt-1 text-lg font-semibold text-foreground">Cargar leads</p>
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Campañas recientes</h2>
            </div>
            <ul className="divide-y divide-border">
              {campaigns.length === 0 && (
                <li className="px-5 py-4 text-sm text-muted-foreground">No hay campañas configuradas.</li>
              )}
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {campaign.is_active ? "Activa" : "Inactiva"} ·{" "}
                      {campaign.workflow_id ? "Con flujo" : "Sin flujo"}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/admin/campanas/${campaign.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Abrir
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("get_home_dashboard_summary");
  if (error) throw new Error(error.message);
  const summary = data as HomeDashboardSummary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Hola, {firstName(profile)}
          </h1>
          <p className="text-sm text-muted-foreground">
            Tu mesa de trabajo para avanzar leads, agendas y gestiones del día.
          </p>
        </div>
        <Link
          href={summary.agenda[0] ? `/dashboard/leads/${summary.agenda[0].id}` : "/dashboard/leads"}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Gestionar siguiente
        </Link>
      </div>

      <LiveDashboard initialSummary={summary} />
    </div>
  );
}
