import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";
import { MetricCard, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import Link from "next/link";
import type { AgentPerformance, HomeDashboardSummary, Profile } from "@/lib/types";
import { endOfDay, REPORT_TIME_ZONE, startOfDay } from "@/lib/report-range";
import { Activity, ArrowUpRight, BarChart3, Settings2 } from "lucide-react";

function countValue(result: { count: number | null; error?: unknown }): string {
  return result.error || result.count === null ? "Sin datos" : result.count.toLocaleString("es-CL");
}

function SnapshotContext({ scope, at }: { scope: string; at: Date }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{scope}</span>
      <span>Consulta al {at.toLocaleString("es-CL", { timeZone: REPORT_TIME_ZONE })} · Chile</span>
      <span>Estado al cargar · Operación contiene el monitoreo</span>
    </div>
  );
}

function firstName(profile: Profile): string {
  return profile.full_name.split(" ")[0] ?? profile.full_name;
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const loadedAt = new Date();

  if (profile.role === "supervisor") {
    // El vínculo de un supervisor con sus equipos vive en teams.supervisor_id.
    // profiles.team_id pertenece al ejecutivo y puede ser null cuando el
    // supervisor administra uno o más equipos.
    const { data: supervisedTeams, error: teamsError } = await supabase
      .from("teams")
      .select("id")
      .eq("supervisor_id", profile.id);
    const teamIds = (supervisedTeams ?? []).map((team) => team.id);
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
    ] = teamIds.length > 0
      ? await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds)
            .eq("role", "agente"),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds)
            .is("assigned_to", null),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds)
            .not("next_action_at", "is", null)
            .lt("next_action_at", nowIso),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds)
            .gte("next_action_at", todayStart)
            .lte("next_action_at", todayEnd),
          supabase
            .from("agent_performance")
            .select("*")
            .in("team_id", teamIds)
            .order("total_interactions", { ascending: false })
            .limit(5),
        ])
      : [
          { count: teamsError ? null : 0, error: teamsError },
          { count: teamsError ? null : 0, error: teamsError },
          { count: teamsError ? null : 0, error: teamsError },
          { count: teamsError ? null : 0, error: teamsError },
          { count: teamsError ? null : 0, error: teamsError },
          { data: [], error: teamsError },
        ];

    const topAgents = (performanceResult.data ?? []) as AgentPerformance[];
    const hasDataError = Boolean(teamsError || agentsResult.error || totalLeadsResult.error || unassignedResult.error || overdueResult.error || todayResult.error || performanceResult.error);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Resumen"
          description={`${firstName(profile)}, supervisa la carga y los compromisos de tus equipos. La atención al cliente corresponde a los ejecutivos.`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/operacion" className={buttonClasses()}>
                Ver operación
              </Link>
              <Link href="/dashboard/team" className={buttonClasses({ variant: "secondary" })}>
                Mi equipo
              </Link>
            </div>
          }
        />

        <SnapshotContext scope="Alcance: tus equipos supervisados · Agendas de hoy y vencidas" at={loadedAt} />

        {hasDataError && (
          <div role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
            No se pudieron consultar todos los indicadores. Los datos no disponibles no representan cero; vuelve a cargar para reintentar.
          </div>
        )}

        {!teamsError && teamIds.length === 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
            Tu usuario supervisor no tiene equipos asignados. Un administrador debe asociarte al menos uno.
          </div>
        )}

        {/* Cada número abre la lista que lo compone. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Agendas vencidas"
            value={countValue(overdueResult)}
            hint="Compromisos vencidos a esta hora"
            href="/dashboard/leads?view=vencidas"
            hrefLabel="Revisar"
            tone={overdueResult.error ? "default" : (overdueResult.count ?? 0) > 0 ? "danger" : "good"}
          />
          <MetricCard
            label="Agendas de hoy"
            value={countValue(todayResult)}
            hint="Día calendario en Chile; puede incluir vencidas"
            href="/dashboard/leads?view=hoy"
            hrefLabel="Ver agenda"
          />
          <MetricCard
            label="Sin asignar"
            value={countValue(unassignedResult)}
            hint="Listo para repartir"
            href="/dashboard/team"
            hrefLabel="Repartir"
            tone={unassignedResult.error ? "default" : (unassignedResult.count ?? 0) > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Base del equipo"
            value={countValue(totalLeadsResult)}
            href="/dashboard/leads"
            hrefLabel="Ver registros"
          />
          <MetricCard
            label="Ejecutivos"
            value={countValue(agentsResult)}
            href="/dashboard/team"
            hrefLabel="Ver carga"
          />
        </div>

        <SectionCard
          title="Rendimiento del equipo"
          description="Acumulado de gestiones disponible, no solo de hoy. Los cinco con más gestiones; abre su cartera para revisar."
        >
          <ul className="divide-y divide-border">
            {topAgents.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">{performanceResult.error ? "Rendimiento no disponible en esta consulta." : "Sin gestiones registradas."}</li>
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
    const configurationAvailable = !campaignsResult.error && !campaignAgentsResult.error;
    const hasDataError = Boolean(activeUsersResult.error || activeCampaignsResult.error || unassignedLeadsResult.error || !configurationAvailable);
    const assignedCampaignIds = new Set((campaignAgentsResult.data ?? []).map((row) => row.campaign_id));
    const campaignsWithoutWorkflow = campaigns.filter((campaign) => campaign.is_active && !campaign.workflow_id);
    const campaignsWithoutAgents = campaigns.filter(
      (campaign) => campaign.is_active && !assignedCampaignIds.has(campaign.id)
    );

    return (
      <div className="space-y-5">
        <PageHeader
          title="Resumen"
          description="Control global de la operación y la configuración. Este espacio no recibe interacciones ni permite responder clientes."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/operacion" className={buttonClasses()}>
                Ver operación
              </Link>
              <Link href="/dashboard/admin/campanas" className={buttonClasses({ variant: "secondary" })}>
                Administración
              </Link>
            </div>
          }
        />

        <SnapshotContext scope="Alcance global · Todas las campañas y usuarios autorizados" at={loadedAt} />

        <div className="grid gap-3 lg:grid-cols-3">
          {[
            { href: "/dashboard/operacion", title: "Operación", description: "Colas de Voice y WhatsApp, carga de ejecutivos y excepciones. Sin abrir conversaciones.", icon: Activity },
            { href: "/dashboard/admin/colas", title: "Configuración", description: "Enrutamiento, capacidad y miembros. Revisa las reglas que organizan la atención.", icon: Settings2 },
            { href: "/dashboard/reportes", title: "Resultados", description: "Indicadores de gestión y discador, con período y filtros explícitos.", icon: BarChart3 },
          ].map(({ href, title, description, icon: Icon }) => (
            <Link key={href} href={href} className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-muted/50">
              <div className="flex items-center justify-between text-primary"><Icon size={20} aria-hidden="true" /><ArrowUpRight size={16} aria-hidden="true" /></div>
              <h2 className="mt-3 text-sm font-semibold text-foreground">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>

        {hasDataError && (
          <div role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
            Hay indicadores no disponibles. No equivalen a cero ni confirman una configuración correcta; vuelve a cargar para reintentar.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Campañas sin flujo"
            value={campaignsResult.error ? "Sin datos" : campaignsWithoutWorkflow.length}
            hint="Activas sin guion; revisar según su canal"
            href="/dashboard/admin/campanas"
            hrefLabel="Revisar"
            tone={campaignsResult.error ? "default" : campaignsWithoutWorkflow.length > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Campañas sin ejecutivos"
            value={configurationAvailable ? campaignsWithoutAgents.length : "Sin datos"}
            hint="Sin ejecutivos de campaña; revisar miembros ACD"
            href="/dashboard/admin/campanas"
            hrefLabel="Revisar"
            tone={!configurationAvailable ? "default" : campaignsWithoutAgents.length > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Registros sin asignar"
            value={countValue(unassignedLeadsResult)}
            href="/dashboard/leads?view=disponibles"
            hrefLabel="Consultar registros"
            tone={unassignedLeadsResult.error ? "default" : (unassignedLeadsResult.count ?? 0) > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Campañas activas"
            value={countValue(activeCampaignsResult)}
            href="/dashboard/admin/campanas"
            hrefLabel="Administrar"
          />
          <MetricCard
            label="Usuarios activos"
            value={countValue(activeUsersResult)}
            href="/dashboard/admin/usuarios?active=si"
            hrefLabel="Ver usuarios"
          />
        </div>

        <SectionCard
          title="Revisión de configuración"
          description="Señales de campañas activas. No sustituyen la salud de canales ni la configuración de miembros de cada cola ACD."
        >
          <ul className="divide-y divide-border">
            {!configurationAvailable && (
              <li className="px-5 py-4 text-sm text-muted-foreground">No fue posible completar la revisión de configuración.</li>
            )}
            {configurationAvailable && campaignsWithoutWorkflow.length === 0 && campaignsWithoutAgents.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted-foreground">
                Todas las campañas activas tienen flujo y ejecutivos asignados.
              </li>
            )}
            {!campaignsResult.error && campaignsWithoutWorkflow.map((campaign) => (
              <li key={`wf-${campaign.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                  <p className="text-xs text-warning">Sin flujo de gestión: revisa si este canal requiere un guion.</p>
                </div>
                <Link
                  href={`/dashboard/admin/campanas/${campaign.id}#flujo`}
                  className="flex-shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  Asignar flujo
                </Link>
              </li>
            ))}
            {configurationAvailable && campaignsWithoutAgents.map((campaign) => (
              <li key={`ag-${campaign.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                  <p className="text-xs text-warning">Sin ejecutivos de campaña: revisa su asignación y los miembros de la cola ACD.</p>
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
              <li className="px-5 py-4 text-sm text-muted-foreground">{campaignsResult.error ? "Campañas no disponibles en esta consulta." : "No hay campañas configuradas."}</li>
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
        title="Mi jornada"
        description={`${firstName(profile)}, este es tu puesto de atención: conversaciones asignadas, llamadas, seguimientos y gestiones del día.`}
        actions={
          <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/conversaciones" className={buttonClasses()}>Mi atención</Link>
          <Link
            href={summary.agenda[0] ? `/dashboard/leads/${summary.agenda[0].id}` : "/dashboard/leads"}
            className={buttonClasses({ variant: "secondary" })}
          >
            {summary.agenda[0] ? "Próximo seguimiento" : "Mis registros"}
          </Link>
          </div>
        }
      />

      <LiveDashboard initialSummary={summary} />
    </div>
  );
}
