import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";
import { MetricCard, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
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
      <div className="space-y-5">
        <PageHeader
          title={`Hola, ${firstName(profile)}`}
          description="Tu foco de hoy: agendas vencidas, trabajo sin asignar y rendimiento del equipo."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/team" className={buttonClasses()}>
                Repartir trabajo
              </Link>
              <Link href="/dashboard/reportes" className={buttonClasses({ variant: "secondary" })}>
                Ver reportes
              </Link>
            </div>
          }
        />

        {!teamId && (
          <div className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
            Tu usuario supervisor no tiene equipo asignado. Un administrador debe asociarte a un equipo.
          </div>
        )}

        {/* Cada número abre la lista que lo compone. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Agendas vencidas"
            value={(overdueResult.count ?? 0).toLocaleString("es-CL")}
            hint="Compromisos a recuperar"
            href="/dashboard/leads?view=vencidas"
            hrefLabel="Recuperar"
            tone={(overdueResult.count ?? 0) > 0 ? "danger" : "good"}
          />
          <MetricCard
            label="Agendas de hoy"
            value={(todayResult.count ?? 0).toLocaleString("es-CL")}
            href="/dashboard/leads?view=hoy"
            hrefLabel="Ver agenda"
          />
          <MetricCard
            label="Sin asignar"
            value={(unassignedResult.count ?? 0).toLocaleString("es-CL")}
            hint="Listo para repartir"
            href="/dashboard/team"
            hrefLabel="Repartir"
            tone={(unassignedResult.count ?? 0) > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Base del equipo"
            value={(totalLeadsResult.count ?? 0).toLocaleString("es-CL")}
            href="/dashboard/leads"
            hrefLabel="Ver registros"
          />
          <MetricCard
            label="Ejecutivos"
            value={(agentsResult.count ?? 0).toLocaleString("es-CL")}
            href="/dashboard/team"
            hrefLabel="Ver carga"
          />
        </div>

        <SectionCard
          title="Rendimiento del equipo"
          description="Los cinco con más gestiones registradas. Abre la cartera de cada uno para revisar su trabajo."
        >
          <ul className="divide-y divide-border">
            {topAgents.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">Sin gestiones registradas.</li>
            )}
            {topAgents.map((agent) => (
              <li key={agent.agent_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{agent.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {agent.leads_managed} registros gestionados · {agent.total_interactions} gestiones
                  </p>
                </div>
                <Link
                  href={`/dashboard/leads?agent=${agent.agent_id}`}
                  className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Ver cartera
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
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
      // Todas las campañas activas: con un tope de 8 los contadores de "sin
      // flujo" y "sin ejecutivos" mentían justo en la pantalla que existe para
      // detectarlos.
      supabase
        .from("campaigns")
        .select("id, name, workflow_id, is_active")
        .order("created_at", { ascending: false }),
      supabase.from("campaign_agents").select("campaign_id"),
    ]);

    const campaigns = campaignsResult.data ?? [];
    const assignedCampaignIds = new Set((campaignAgentsResult.data ?? []).map((row) => row.campaign_id));
    const campaignsWithoutWorkflow = campaigns.filter((campaign) => campaign.is_active && !campaign.workflow_id);
    const campaignsWithoutAgents = campaigns.filter(
      (campaign) => campaign.is_active && !assignedCampaignIds.has(campaign.id)
    );

    return (
      <div className="space-y-5">
        <PageHeader
          title="Salud de la plataforma"
          description="Qué está sin configurar y qué puede frenar la operación hoy."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/admin/campanas" className={buttonClasses()}>
                Campañas
              </Link>
              <Link href="/dashboard/admin/cargas" className={buttonClasses({ variant: "secondary" })}>
                Cargar base
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Campañas sin flujo"
            value={campaignsWithoutWorkflow.length}
            hint="No tienen guion de gestión"
            href="/dashboard/admin/campanas"
            hrefLabel="Revisar"
            tone={campaignsWithoutWorkflow.length > 0 ? "danger" : "good"}
          />
          <MetricCard
            label="Campañas sin ejecutivos"
            value={campaignsWithoutAgents.length}
            hint="No pueden operar"
            href="/dashboard/admin/campanas"
            hrefLabel="Revisar"
            tone={campaignsWithoutAgents.length > 0 ? "danger" : "good"}
          />
          <MetricCard
            label="Registros sin asignar"
            value={(unassignedLeadsResult.count ?? 0).toLocaleString("es-CL")}
            href="/dashboard/leads?view=disponibles"
            hrefLabel="Ver disponibles"
            tone={(unassignedLeadsResult.count ?? 0) > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Campañas activas"
            value={activeCampaignsResult.count ?? 0}
            href="/dashboard/admin/campanas"
            hrefLabel="Administrar"
          />
          <MetricCard
            label="Usuarios activos"
            value={activeUsersResult.count ?? 0}
            href="/dashboard/admin/usuarios?active=si"
            hrefLabel="Ver usuarios"
          />
        </div>

        <SectionCard
          title="Requiere configuración"
          description="Cada fila lleva directo al lugar donde se arregla."
        >
          <ul className="divide-y divide-border">
            {campaignsWithoutWorkflow.length === 0 && campaignsWithoutAgents.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">
                Todas las campañas activas tienen flujo y ejecutivos asignados.
              </li>
            )}
            {campaignsWithoutWorkflow.map((campaign) => (
              <li key={`wf-${campaign.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                  <p className="text-xs text-danger">Sin flujo de gestión: los ejecutivos no tendrán guion.</p>
                </div>
                <Link
                  href={`/dashboard/admin/campanas/${campaign.id}#flujo`}
                  className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Asignar flujo
                </Link>
              </li>
            ))}
            {campaignsWithoutAgents.map((campaign) => (
              <li key={`ag-${campaign.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                  <p className="text-xs text-danger">Sin ejecutivos asignados: la campaña no puede operar.</p>
                </div>
                <Link
                  href={`/dashboard/admin/campanas/${campaign.id}/ejecutivos`}
                  className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Asignar ejecutivos
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Campañas recientes" description="Las ocho últimas creadas.">
          <ul className="divide-y divide-border">
            {campaigns.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">No hay campañas configuradas.</li>
            )}
            {campaigns.slice(0, 8).map((campaign) => (
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
                  className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("get_home_dashboard_summary");
  if (error) throw new Error(error.message);
  const summary = data as HomeDashboardSummary;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hola, ${firstName(profile)}`}
        description="Tu mesa de trabajo: la siguiente llamada, tus agendas y las gestiones del día."
        actions={
          <Link
            href={summary.agenda[0] ? `/dashboard/leads/${summary.agenda[0].id}` : "/dashboard/leads"}
            className={buttonClasses()}
          >
            {summary.agenda[0] ? "Llamar al siguiente" : "Ver mis registros"}
          </Link>
        }
      />

      <LiveDashboard initialSummary={summary} />
    </div>
  );
}
