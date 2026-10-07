import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";
import { Avatar, Badge, Callout, EmptyState, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import { KpiStrip, KpiStripItem, type KpiTone } from "@/components/report-kit";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgentPerformance, HomeDashboardSummary, Profile } from "@/lib/types";
import { endOfDay, REPORT_TIME_ZONE, startOfDay } from "@/lib/report-range";
import {
  Activity,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  CircleCheck,
  Clock,
  Database,
  LayoutDashboard,
  Megaphone,
  Settings2,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  UserRoundX,
  Users,
  Workflow,
} from "lucide-react";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";
import { InicioClinica } from "@/components/inicio-clinica";
import { InicioComercial } from "@/components/inicio-comercial";
import { contextoDeMiEmpresa, puedeLeerConversaciones } from "@/lib/modules.server";
import { setupEntryHref } from "@/lib/nav.config";

function countValue(result: { count: number | null; error?: unknown }): string {
  return result.error || result.count === null ? "Sin datos" : result.count.toLocaleString("es-CL");
}

/**
 * Tono de una cifra de la franja: el color solo aparece cuando hay algo que
 * atender. Un cero (o un dato que no se pudo leer) va gris, no verde: "todo
 * bien" lo dice la ausencia de alerta, no otra mancha de color.
 */
function attentionTone(result: { count: number | null; error?: unknown }, alert: KpiTone = "warn"): KpiTone {
  if (result.error || result.count === null) return "default";
  return result.count > 0 ? alert : "default";
}

const hourFormat = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

/** "Hace 3 días", "Hace 5 h": la antigüedad se lee mejor que una fecha completa. */
function relativeLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "Recién" : `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "Ayer" : `Hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "Hace 1 mes" : `Hace ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? "Hace 1 año" : `Hace ${years} años`;
}

/**
 * Contexto de la lectura en la línea meta del encabezado: alcance y hora de
 * la consulta (en Chile). La foto es del momento de carga; el monitoreo en
 * vivo está en Operación.
 */
function SnapshotMeta({ scope, at }: { scope: string; at: Date }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <Activity size={13} aria-hidden="true" />
        {scope}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock size={13} aria-hidden="true" />
        Estado a las {hourFormat.format(at)}
      </span>
    </>
  );
}

function firstName(profile: Profile): string {
  return profile.full_name.split(" ")[0] ?? profile.full_name;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  // Calidad no tiene operación propia: su inicio es el tablero de calidad.
  if (profile.role === "calidad") redirect("/dashboard/calidad/resumen");

  // Una clínica no tiene colas ni discador: su inicio es de presupuestos y
  // pacientes. El de contact center queda para la edición Center.
  const contexto = await contextoDeMiEmpresa();
  if (contexto.edicion !== "center") {
    // Quien atiende (rol agente) entra directo a su día: sus citas y su comisión.
    if (profile.role === "agente") redirect("/dashboard/mi-dia");
    return (
      <InicioClinica
        profile={profile}
        edicion={contexto.edicion}
        empresa={contexto.empresa}
        leeConversaciones={await puedeLeerConversaciones(profile.role)}
      />
    );
  }

  // Una empresa que vende B2B sin call center (Altius) no tiene colas ni
  // discador: su inicio es el puesto de trabajo comercial.
  if (!contexto.modulos.includes("contact_center") && contexto.modulos.includes("ventas_b2b") && profile.role !== "agente") {
    return <InicioComercial profile={profile} edicion={contexto.edicion} empresa={contexto.empresa} />;
  }

  const supabase = await createClient();
  const loadedAt = new Date();
  const todayLabel = capitalize(dateFormat.format(loadedAt));

  if (profile.role === "supervisor") {
    let teamIds: string[] = [];
    let teamsError: Error | null = null;
    try {
      teamIds = await getSupervisedTeamIds(supabase);
    } catch (error) {
      teamsError = error instanceof Error ? error : new Error("No se pudo consultar el alcance supervisor.");
    }
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
    const leader = Math.max(1, ...topAgents.map((agent) => agent.total_interactions));
    const overdueCount = overdueResult.error ? null : overdueResult.count ?? 0;
    const unassignedCount = unassignedResult.error ? null : unassignedResult.count ?? 0;

    // Lo primero del día, en una frase: vencidas antes que reparto.
    const firstThing =
      overdueCount && overdueCount > 0
        ? `Lo primero: ${overdueCount.toLocaleString("es-CL")} ${overdueCount === 1 ? "agenda vencida" : "agendas vencidas"} en tus equipos.`
        : unassignedCount && unassignedCount > 0
          ? `Lo primero: ${unassignedCount.toLocaleString("es-CL")} registros esperan reparto.`
          : "Supervisa la carga y los compromisos de tus equipos; la atención al cliente es de los ejecutivos.";

    return (
      <div className="space-y-5">
        <PageHeader
          icon={LayoutDashboard}
          title={`Hola, ${firstName(profile)}`}
          description={`${todayLabel}. ${firstThing}`}
          meta={<SnapshotMeta scope="Tus equipos supervisados" at={loadedAt} />}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/team" className={buttonClasses({ variant: "secondary" })}>
                <Users size={15} aria-hidden="true" />
                Mi equipo
              </Link>
              <Link href="/dashboard/operacion" className={buttonClasses()}>
                Ver operación
              </Link>
            </div>
          }
        />

        {hasDataError && (
          <div role="status">
            <Callout tone="warning" className="px-4 py-3">
              No se pudieron consultar todos los indicadores. Los datos no disponibles no representan cero; vuelve a cargar para reintentar.
            </Callout>
          </div>
        )}

        {!teamsError && teamIds.length === 0 && (
          <Callout tone="danger" className="px-4 py-3">
            Tu usuario supervisor no tiene equipos asignados. Un administrador debe asociarte al menos uno.
          </Callout>
        )}

        {/* Cada número abre la lista que lo compone. Lo urgente va primero. */}
        <KpiStrip title="Hoy en tus equipos" meta="Día calendario en Chile">
          <KpiStripItem
            label="Agendas vencidas"
            icon={CalendarX2}
            value={countValue(overdueResult)}
            tone={attentionTone(overdueResult, "danger")}
            detail="Compromisos vencidos a esta hora"
            href="/dashboard/leads?view=vencidas"
          />
          <KpiStripItem
            label="Agendas de hoy"
            icon={CalendarClock}
            value={countValue(todayResult)}
            detail="Puede incluir vencidas"
            href="/dashboard/leads?view=hoy"
          />
          <KpiStripItem
            label="Sin asignar"
            icon={UserPlus}
            value={countValue(unassignedResult)}
            tone={attentionTone(unassignedResult)}
            detail="Listo para repartir"
            href="/dashboard/team"
          />
          <KpiStripItem
            label="Base del equipo"
            icon={Database}
            value={countValue(totalLeadsResult)}
            detail="Registros de tus equipos"
            href="/dashboard/leads"
          />
          <KpiStripItem
            label="Ejecutivos"
            icon={Users}
            value={countValue(agentsResult)}
            detail="Ver la carga de cada uno"
            href="/dashboard/team"
          />
        </KpiStrip>

        <SectionCard
          title="Rendimiento del equipo"
          description="Acumulado de gestiones disponible, no solo de hoy. Los cinco con más gestiones; abre su cartera para revisar."
        >
          {topAgents.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title={performanceResult.error ? "Rendimiento no disponible en esta consulta." : "Sin gestiones registradas."}
              className="py-8"
            />
          ) : (
            <ol className="divide-y divide-border/70 border-t border-border">
              {topAgents.map((agent, index) => (
                <li key={agent.agent_id}>
                  <Link
                    href={`/dashboard/leads?agent=${agent.agent_id}`}
                    className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={`Ver cartera de ${agent.full_name}`}
                  >
                    <span className="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground" aria-hidden="true">
                      {index + 1}
                    </span>
                    <Avatar name={agent.full_name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{agent.full_name}</p>
                      <div className="mt-1.5 h-1 max-w-xs overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(agent.total_interactions / leader) * 100}%` }}
                        />
                      </div>
                    </div>
                    <dl className="flex shrink-0 gap-5 text-right">
                      <div>
                        <dt className="text-[10px] text-muted-foreground">Gestiones</dt>
                        <dd className="text-sm font-semibold tabular-nums text-foreground">{agent.total_interactions.toLocaleString("es-CL")}</dd>
                      </div>
                      <div className="hidden sm:block">
                        <dt className="text-[10px] text-muted-foreground">Registros</dt>
                        <dd className="text-sm tabular-nums text-foreground">{agent.leads_managed.toLocaleString("es-CL")}</dd>
                      </div>
                    </dl>
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
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
      aiVoiceConfigsResult,
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
      // detectarlos. `created_at` solo se lee para mostrar la antigüedad.
      supabase
        .from("campaigns")
        .select("id, name, workflow_id, is_active, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("campaign_agents").select("campaign_id"),
      supabase.from("ai_voice_campaign_configs").select("campaign_id"),
    ]);

    const setupHref = setupEntryHref(profile.role, contexto.modulos, contexto.edicion);
    const campaigns = campaignsResult.data ?? [];
    const configurationAvailable = !campaignsResult.error && !campaignAgentsResult.error && !aiVoiceConfigsResult.error;
    const hasDataError = Boolean(activeUsersResult.error || activeCampaignsResult.error || unassignedLeadsResult.error || !configurationAvailable);
    const assignedCampaignIds = new Set((campaignAgentsResult.data ?? []).map((row) => row.campaign_id));
    // En voz IA el guion vive en el agente ElevenLabs y no hay ejecutivos que
    // tipifiquen: la ficha de la campaña ya la da por configurada, el resumen
    // tiene que decir lo mismo.
    const aiVoiceCampaignIds = new Set((aiVoiceConfigsResult.data ?? []).map((row) => row.campaign_id));
    const humanCampaigns = campaigns.filter((campaign) => campaign.is_active && !aiVoiceCampaignIds.has(campaign.id));
    const campaignsWithoutWorkflow = humanCampaigns.filter((campaign) => !campaign.workflow_id);
    const campaignsWithoutAgents = humanCampaigns.filter((campaign) => !assignedCampaignIds.has(campaign.id));
    const pendingCount = (campaignsResult.error ? 0 : campaignsWithoutWorkflow.length) + (configurationAvailable ? campaignsWithoutAgents.length : 0);

    // Las observaciones de configuración en una sola lista: cada fila es una
    // campaña con lo que le falta y la acción que lo resuelve.
    const issues = [
      ...(!campaignsResult.error
        ? campaignsWithoutWorkflow.map((campaign) => ({
            key: `wf-${campaign.id}`,
            campaign,
            icon: Workflow,
            badge: "Sin flujo",
            text: "Revisa si este canal requiere un guion de gestión.",
            href: `/dashboard/admin/campanas/${campaign.id}#flujo`,
            action: "Asignar flujo",
          }))
        : []),
      ...(configurationAvailable
        ? campaignsWithoutAgents.map((campaign) => ({
            key: `ag-${campaign.id}`,
            campaign,
            icon: UserRoundX,
            badge: "Sin ejecutivos",
            text: "Revisa su asignación y los miembros de la cola ACD.",
            href: `/dashboard/admin/campanas/${campaign.id}/ejecutivos`,
            action: "Asignar ejecutivos",
          }))
        : []),
    ];

    const firstThing =
      pendingCount > 0
        ? `Lo primero: ${pendingCount} ${pendingCount === 1 ? "observación" : "observaciones"} de configuración en campañas activas.`
        : "Control global de la operación y la configuración. Este espacio no atiende clientes.";

    return (
      <div className="space-y-5">
        <PageHeader
          icon={LayoutDashboard}
          title={`Hola, ${firstName(profile)}`}
          description={`${todayLabel}. ${firstThing}`}
          meta={<SnapshotMeta scope="Alcance global" at={loadedAt} />}
          actions={
            <div className="flex flex-wrap gap-2">
              {/* Una sola puerta a Configuración, la misma del menú lateral:
                  antes había un botón «Administración» y una tarjeta
                  «Configuración» que llevaban a pantallas distintas. */}
              {setupHref && (
                <Link href={setupHref} className={buttonClasses({ variant: "secondary" })}>
                  <Settings2 size={15} aria-hidden="true" />
                  Configuración
                </Link>
              )}
              <Link href="/dashboard/operacion" className={buttonClasses()}>
                Ver operación
              </Link>
            </div>
          }
        />

        {hasDataError && (
          <div role="status">
            <Callout tone="warning" className="px-4 py-3">
              Hay indicadores no disponibles. No equivalen a cero ni confirman una configuración correcta; vuelve a cargar para reintentar.
            </Callout>
          </div>
        )}

        {/* Cada celda abre la lista que compone la cifra. */}
        <KpiStrip title="Estado de la operación" meta="Campañas activas con atención humana">
          <KpiStripItem
            label="Campañas sin flujo"
            icon={Workflow}
            value={campaignsResult.error ? "Sin datos" : campaignsWithoutWorkflow.length.toLocaleString("es-CL")}
            tone={campaignsResult.error || campaignsWithoutWorkflow.length === 0 ? "default" : "warn"}
            detail="Activas sin guion; revisar según su canal"
            href="/dashboard/admin/campanas"
          />
          <KpiStripItem
            label="Campañas sin ejecutivos"
            icon={UserRoundX}
            value={configurationAvailable ? campaignsWithoutAgents.length.toLocaleString("es-CL") : "Sin datos"}
            tone={!configurationAvailable || campaignsWithoutAgents.length === 0 ? "default" : "warn"}
            detail="Revisar miembros ACD"
            href="/dashboard/admin/campanas"
          />
          <KpiStripItem
            label="Registros sin asignar"
            icon={UserPlus}
            value={countValue(unassignedLeadsResult)}
            detail="Disponibles para repartir"
            href="/dashboard/leads?view=disponibles"
          />
          <KpiStripItem
            label="Campañas activas"
            icon={Megaphone}
            value={countValue(activeCampaignsResult)}
            detail="Administrar campañas"
            href="/dashboard/admin/campanas"
          />
          <KpiStripItem
            label="Usuarios activos"
            icon={Users}
            value={countValue(activeUsersResult)}
            detail="Ver usuarios"
            href="/dashboard/admin/usuarios?active=si"
          />
        </KpiStrip>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SectionCard
            title="Revisión de configuración"
            description="Señales de campañas activas. No sustituyen la salud de canales ni los miembros de cada cola ACD."
            actions={
              configurationAvailable && issues.length > 0 ? (
                <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-foreground">
                  {issues.length}
                </span>
              ) : undefined
            }
          >
            {!configurationAvailable && issues.length === 0 && (
              <EmptyState icon={ShieldCheck} title="No fue posible completar la revisión de configuración." className="py-8" />
            )}
            {configurationAvailable && issues.length === 0 && (
              <div className="flex items-center gap-3 border-t border-border px-5 py-4 text-sm text-foreground">
                <span className="icon-chip size-8 rounded-lg" data-tone="green" aria-hidden="true">
                  <CircleCheck size={16} />
                </span>
                <div>
                  <p className="font-medium">Todo en orden</p>
                  <p className="text-xs text-muted-foreground">Todas las campañas activas tienen flujo y ejecutivos asignados.</p>
                </div>
              </div>
            )}
            {issues.length > 0 && (
              <ul className="divide-y divide-border/70 border-t border-border">
                {issues.map((issue) => (
                  <li key={issue.key} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={issue.campaign.name} seed={issue.campaign.id} shape="square" size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                        <p className="truncate text-sm font-medium text-foreground">{issue.campaign.name}</p>
                        <Badge tone="warning">{issue.badge}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{issue.text}</p>
                    </div>
                    <Link href={issue.href} className={buttonClasses({ variant: "secondary", size: "sm", className: "shrink-0" })}>
                      <issue.icon size={13} aria-hidden="true" />
                      {issue.action}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Campañas recientes"
            description="Las ocho últimas creadas."
            actions={
              <Link href="/dashboard/admin/campanas" className="text-xs font-medium text-primary hover:underline">
                Ver todas
              </Link>
            }
          >
            {campaigns.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title={campaignsResult.error ? "Campañas no disponibles en esta consulta." : "No hay campañas configuradas."}
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-border/70 border-t border-border">
                {campaigns.slice(0, 8).map((campaign) => (
                  <li key={campaign.id}>
                    <Link
                      href={`/dashboard/admin/campanas/${campaign.id}`}
                      className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <Avatar name={campaign.name} seed={campaign.id} shape="square" size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge tone={campaign.is_active ? "success" : "neutral"} dot>
                            {campaign.is_active ? "Activa" : "Inactiva"}
                          </Badge>
                          <span aria-hidden="true">·</span>
                          <span>{campaign.workflow_id ? "Con flujo" : "Sin flujo"}</span>
                        </p>
                      </div>
                      {relativeLabel(campaign.created_at, loadedAt) && (
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          {relativeLabel(campaign.created_at, loadedAt)}
                        </span>
                      )}
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("get_home_dashboard_summary");
  if (error) throw new Error(error.message);
  const summary = data as HomeDashboardSummary;
  const nextAgenda = summary.agenda[0];

  return (
    <div className="space-y-5">
      {/* El título coincide con el menú del ejecutivo ("Mi jornada"); el saludo
          y lo primero del día van en la descripción. */}
      <PageHeader
        icon={LayoutDashboard}
        title="Mi jornada"
        description={
          nextAgenda
            ? `Hola, ${firstName(profile)}. ${todayLabel}. Lo primero: tu seguimiento con ${nextAgenda.full_name} a las ${hourFormat.format(new Date(nextAgenda.next_action_at))}.`
            : `Hola, ${firstName(profile)}. ${todayLabel}. Tu puesto de atención: conversaciones asignadas, llamadas, seguimientos y gestiones del día.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={nextAgenda ? `/dashboard/leads/${nextAgenda.id}` : "/dashboard/leads"}
              className={buttonClasses({ variant: "secondary" })}
            >
              {nextAgenda ? "Próximo seguimiento" : "Mis registros"}
            </Link>
            <Link href="/dashboard/conversaciones" className={buttonClasses()}>Mi atención</Link>
          </div>
        }
      />

      <LiveDashboard initialSummary={summary} />
    </div>
  );
}
