import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assignLead, reassignAgenda } from "@/app/actions/admin";
import { StatCard } from "@/components/stat-card";
import { LEAD_STATUSES } from "@/lib/types";
import Link from "next/link";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;
type Option = { id: string; name?: string; full_name?: string };
type TeamReportSummary = {
  kpis?: {
    base_total?: number;
    asignados?: number;
    sin_asignar?: number;
    agendas_vencidas?: number;
  };
  agents?: {
    agent_id: string;
    is_historical_only?: boolean;
  }[];
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Convierte un ISO timestamp al formato que espera <input type="datetime-local">. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TEAM_REPORT_WINDOW_DAYS = 180;

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

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; campaign?: string; status?: string }>;
}) {
  const profile = await requireProfile(["supervisor"]);
  const { agent, campaign, status } = await searchParams;
  const supabase = await createClient();
  const filters = {
    agent: agent || "",
    campaign: campaign || "",
    status: status || "",
  };

  if (!profile.team_id) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-bg p-5 text-sm text-danger">
        Tu usuario supervisor no tiene equipo asignado. Un administrador debe asociarte a un equipo antes de usar esta vista.
      </div>
    );
  }

  const reportTo = endOfDay(new Date());
  const reportFrom = startOfDay(addDays(reportTo, -(TEAM_REPORT_WINDOW_DAYS - 1)));

  const [{ data: agents }, { data: campaigns }, { data: teamReport }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("team_id", profile.team_id)
      .eq("role", "agente")
      .order("full_name"),
    supabase.from("campaigns").select("id, name").order("name"),
    supabase.rpc("get_supervisor_report_summary", {
      p_from: reportFrom.toISOString(),
      p_to: reportTo.toISOString(),
      p_team_id: null,
    }),
  ]);

  const leadsQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, assigned_to, campaign_id")
    .order("updated_at", { ascending: false })
    .limit(150);
  if (filters.agent) leadsQuery.eq("assigned_to", filters.agent);
  if (filters.campaign) leadsQuery.eq("campaign_id", filters.campaign);
  if (filters.status) leadsQuery.eq("status", filters.status);
  const { data: leads } = profile.team_id
    ? await leadsQuery.eq("team_id", profile.team_id)
    : { data: [] };

  const agendaQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, campaign_id, next_action_at, managed_by, profiles!leads_managed_by_fkey(full_name)")
    .eq("team_id", profile.team_id)
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(100);
  if (filters.agent) agendaQuery.eq("managed_by", filters.agent);
  if (filters.campaign) agendaQuery.eq("campaign_id", filters.campaign);
  if (filters.status) agendaQuery.eq("status", filters.status);
  const { data: agendaLeads } = profile.team_id ? await agendaQuery : { data: [] };

  const now = new Date();
  const agendaRows = agendaLeads ?? [];
  const overdueAgenda = agendaRows.filter((lead) => new Date(lead.next_action_at!) <= now);
  const upcomingAgenda = agendaRows.filter((lead) => new Date(lead.next_action_at!) > now);
  const unassigned = (leads ?? []).filter((lead) => !lead.assigned_to).length;
  const activeAgents = agents ?? [];
  const reportSummary = teamReport as TeamReportSummary | null;
  const reportedAgents = reportSummary?.agents ?? [];
  const reportedAgentsCount = reportedAgents.length || activeAgents.length;
  const historicalAgentsCount = reportedAgents.filter((agent) => agent.is_historical_only).length;
  const reportKpis = reportSummary?.kpis;
  const visibleBaseTotal = reportKpis?.base_total ?? (leads ?? []).length;
  const visibleUnassigned = reportKpis?.sin_asignar ?? unassigned;
  const visibleOverdue = reportKpis?.agendas_vencidas ?? overdueAgenda.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Mi equipo</h1>
          <p className="text-sm text-muted-foreground">
            Asigna leads, corrige agendas vencidas y monitorea la carga de tus ejecutivos.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ejecutivos reportados"
          value={reportedAgentsCount}
          hint={`${activeAgents.length} activos para asignación${historicalAgentsCount ? ` · ${historicalAgentsCount} históricos` : ""}`}
          progress={percent(activeAgents.length, reportedAgentsCount)}
          tone="good"
        />
        <StatCard
          label="Base equipo"
          value={visibleBaseTotal.toLocaleString("es-CL")}
          hint="Datos agregados desde Supabase"
          progress={percent(reportKpis?.asignados ?? 0, visibleBaseTotal)}
        />
        <StatCard
          label="Sin asignar"
          value={visibleUnassigned.toLocaleString("es-CL")}
          hint="Disponible para distribución"
          progress={percent(visibleUnassigned, visibleBaseTotal)}
          tone={visibleUnassigned > 0 ? "warn" : "good"}
        />
        <StatCard
          label="Agendas vencidas"
          value={visibleOverdue.toLocaleString("es-CL")}
          hint="Compromisos a recuperar"
          progress={percent(visibleOverdue, Math.max(visibleOverdue, reportKpis?.agendas_vencidas ?? overdueAgenda.length))}
          tone={visibleOverdue > 0 ? "danger" : "good"}
        />
      </div>

      <form className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[repeat(3,minmax(180px,1fr))_auto]">
        <select
          name="agent"
          defaultValue={filters.agent}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todos los ejecutivos activos</option>
          {(activeAgents as Option[]).map((option) => (
            <option key={option.id} value={option.id}>
              {option.full_name}
            </option>
          ))}
        </select>
        <select
          name="campaign"
          defaultValue={filters.campaign}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todas las campañas</option>
          {((campaigns ?? []) as Option[]).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={filters.status}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todos los estados</option>
          {LEAD_STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Filtrar
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Agendas vencidas</h2>
          <p className="text-xs text-muted-foreground">
            Reasigna o corrige primero estas llamadas para recuperar SLA operativo.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Ejecutivo</th>
              <th className="px-5 py-3 font-medium">Agenda</th>
              <th className="px-5 py-3 font-medium">Reagendar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {overdueAgenda.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  No hay agendas vencidas con estos filtros.
                </td>
              </tr>
            )}
            {overdueAgenda.map((lead) => {
              const managerName = one(lead.profiles as ProfileEmbed)?.full_name ?? "—";
              return (
                <tr key={lead.id}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-primary">
                      {lead.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{managerName}</td>
                  <td className="px-5 py-3 font-medium text-danger">
                    Vencida: {new Date(lead.next_action_at!).toLocaleString("es-CL")}
                  </td>
                  <td className="px-5 py-3">
                    <form action={reassignAgenda} className="flex items-center gap-2">
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <select
                        name="agent_id"
                        defaultValue={lead.managed_by ?? ""}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {activeAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="datetime-local"
                        name="next_action_at"
                        defaultValue={toDatetimeLocal(lead.next_action_at!)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                      >
                        Reagendar
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Próximas agendas</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Ejecutivo</th>
              <th className="px-5 py-3 font-medium">Agenda</th>
              <th className="px-5 py-3 font-medium">Reagendar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {upcomingAgenda.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  No hay próximas agendas con estos filtros.
                </td>
              </tr>
            )}
            {upcomingAgenda.map((lead) => {
              const managerName = one(lead.profiles as ProfileEmbed)?.full_name ?? "—";
              return (
                <tr key={lead.id}>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-primary">
                      {lead.full_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{managerName}</td>
                  <td className="px-5 py-3 text-foreground">
                    {new Date(lead.next_action_at!).toLocaleString("es-CL")}
                  </td>
                  <td className="px-5 py-3">
                    <form action={reassignAgenda} className="flex items-center gap-2">
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <select
                        name="agent_id"
                        defaultValue={lead.managed_by ?? ""}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {activeAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="datetime-local"
                        name="next_action_at"
                        defaultValue={toDatetimeLocal(lead.next_action_at!)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                      >
                        Reagendar
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Asignación de leads</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">RUT</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium">Asignado a</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(leads ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  No hay leads en tu equipo todavía.
                </td>
              </tr>
            )}
            {(leads ?? []).map((lead) => (
              <tr key={lead.id}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-primary">
                    {lead.full_name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{lead.rut ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className="rounded-full bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    {LEAD_STATUSES.find((s) => s.value === lead.status)?.label ?? lead.status}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <form action={assignLead} className="flex items-center gap-2">
                    <input type="hidden" name="lead_id" value={lead.id} />
                    <select
                      name="agent_id"
                      defaultValue={lead.assigned_to ?? ""}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Sin asignar</option>
                      {activeAgents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      Asignar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
