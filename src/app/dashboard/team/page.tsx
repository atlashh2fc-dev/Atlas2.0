import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { reassignAgenda } from "@/app/actions/admin";
import { LEAD_STATUSES } from "@/lib/types";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarX2, Database, MessageCircle, Phone, UserPlus, Users, Video, MapPin } from "lucide-react";
import {
  ActionForm,
  ActionSubmit,
  Avatar,
  Badge,
  Callout,
  FilterBar,
  Field,
  NavTabs,
  PageHeader,
  SectionCard,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TableEmpty,
  Tr,
} from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { CallbacksPanel, type CallbackRow } from "@/components/callbacks-panel";
import { TeamCampaignControl } from "@/components/team-campaign-control";
import { listAgentCampaignBoard, type AgentCampaignBoardRow } from "@/app/actions/campaign-control";
// Los días del reporte son los de Chile: el servidor corre en UTC y con
// setHours la ventana terminaba a las 21:00 de hoy.
import { REPORT_TIME_ZONE, addDays, endOfDay, startOfDay, toDateTimeInput } from "@/lib/report-range";
import {
  TeamAgentsTable,
  TeamLeadsAssignment,
  type TeamAgentRow,
  type TeamLeadRow,
} from "@/components/team-tables";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;
type Option = { id: string; name?: string; full_name?: string };
type AgentOption = { id: string; full_name: string };
type AgendaLead = {
  id: string;
  full_name: string;
  next_action_at: string | null;
  next_action_channel: "phone" | "whatsapp" | "video_meeting" | "in_person" | null;
  managed_by: string | null;
  profiles: ProfileEmbed;
};
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
  return toDateTimeInput(new Date(iso));
}

const AGENDA_DAY = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, day: "numeric", month: "short" });
const AGENDA_HOUR = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** "24 may · 09:27", en hora de Chile. */
function formatAgendaDateTime(iso: string): string {
  const date = new Date(iso);
  return `${AGENDA_DAY.format(date).replace(".", "")} · ${AGENDA_HOUR.format(date)}`;
}

function agendaChannelLabel(channel: AgendaLead["next_action_channel"]): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "video_meeting") return "Videollamada";
  if (channel === "in_person") return "Presencial";
  return "Llamada";
}

function agendaChannelIcon(channel: AgendaLead["next_action_channel"]) {
  if (channel === "whatsapp") return MessageCircle;
  if (channel === "video_meeting") return Video;
  if (channel === "in_person") return MapPin;
  return Phone;
}

/**
 * Título de una sección cuya tabla ya trae su propia tarjeta (DataTable):
 * envolverla en otra tarjeta dejaba un marco dentro de otro.
 */
function SectionHeading({
  id,
  title,
  description,
  count,
  actions,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-20 flex-wrap items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          {title}
          {typeof count === "number" && (
            <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {count.toLocaleString("es-CL")}
            </span>
          )}
        </h2>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

const TEAM_REPORT_WINDOW_DAYS = 180;

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

/** Formulario en línea para reasignar ejecutivo y fecha de una agenda. */
function ReassignForm({ lead, agents }: { lead: AgendaLead; agents: AgentOption[] }) {
  return (
    <ActionForm action={reassignAgenda} success="Agenda reasignada" className="flex items-center gap-2">
      <input type="hidden" name="lead_id" value={lead.id} />
      <Select name="agent_id" fieldSize="sm" defaultValue={lead.managed_by ?? ""} className="w-auto">
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
          </option>
        ))}
      </Select>
      <input
        type="datetime-local"
        name="next_action_at"
        defaultValue={toDatetimeLocal(lead.next_action_at!)}
        className="h-8 rounded-lg border border-border-strong/70 bg-surface px-2.5 text-xs text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <ActionSubmit size="sm" variant="secondary" pendingLabel="Reagendando…">
        Reagendar
      </ActionSubmit>
    </ActionForm>
  );
}

/** Tabla de agendas (vencidas o próximas) con reasignación en línea. */
function AgendaTable({
  title,
  description,
  rows,
  agents,
  overdue,
  emptyText,
}: {
  title: string;
  description?: string;
  rows: AgendaLead[];
  agents: AgentOption[];
  overdue: boolean;
  emptyText: string;
}) {
  return (
    <SectionCard
      title={title}
      description={description}
      actions={
        <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {rows.length}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Th>Registro</Th>
            <Th>Ejecutivo</Th>
            <Th>Agenda</Th>
            <Th>Reagendar</Th>
          </Thead>
          <Tbody>
            {rows.length === 0 && <TableEmpty colSpan={4}>{emptyText}</TableEmpty>}
            {rows.map((lead) => {
              const managerName = one(lead.profiles)?.full_name ?? null;
              const ChannelIcon = agendaChannelIcon(lead.next_action_channel);
              return (
                <Tr key={lead.id}>
                  <Td>
                    <Link href={`/dashboard/leads/${lead.id}`} className="flex min-w-0 items-center gap-3">
                      <Avatar name={lead.full_name} size="md" />
                      <span className="min-w-0">
                        <span className="block max-w-[16rem] truncate font-medium text-foreground group-hover:text-primary">
                          {lead.full_name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <ChannelIcon size={12} aria-hidden="true" />
                          {agendaChannelLabel(lead.next_action_channel)}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    {managerName ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={managerName} size="xs" />
                        <span className="truncate text-foreground">{managerName}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Sin responsable</span>
                    )}
                  </Td>
                  <Td>
                    <span className="block whitespace-nowrap tabular-nums text-foreground">{formatAgendaDateTime(lead.next_action_at!)}</span>
                    {overdue && (
                      <Badge tone="danger" className="mt-0.5">
                        Vencida
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <ReassignForm lead={lead} agents={agents} />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>
    </SectionCard>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; campaign?: string; status?: string }>;
}) {
  const viewer = await requireProfile(["supervisor"]);
  const { agent, campaign, status } = await searchParams;
  const campaignScope = resolveCampaignScope(campaign);
  const supabase = await createClient();
  let campaignBoard: AgentCampaignBoardRow[] = [];
  let campaignBoardError = false;
  try {
    campaignBoard = await listAgentCampaignBoard();
  } catch (error) {
    console.error("[equipo] asignación de campañas:", error);
    campaignBoardError = true;
  }
  const filters = {
    agent: agent || "",
    campaign: campaignScope || "",
    status: status || "",
  };

  const reportTo = endOfDay(new Date());
  const reportFrom = startOfDay(addDays(reportTo, -(TEAM_REPORT_WINDOW_DAYS - 1)));

  const [{ data: agents }, { data: campaigns }, { data: teamReport }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "agente")
      .order("full_name"),
    supabase.rpc("get_report_scope_campaigns"),
    supabase.rpc("get_supervisor_report_summary", {
      p_from: reportFrom.toISOString(),
      p_to: reportTo.toISOString(),
      p_team_id: null,
      p_campaign_id: campaignScope || null,
    }),
  ]);

  const leadsQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, assigned_to, campaign_id, profiles!leads_assigned_to_fkey(full_name)")
    .order("updated_at", { ascending: false })
    .limit(250);
  if (filters.agent) leadsQuery.eq("assigned_to", filters.agent);
  if (filters.campaign) leadsQuery.eq("campaign_id", filters.campaign);
  if (filters.status) leadsQuery.eq("status", filters.status);
  const { data: leads } = await leadsQuery;

  const agendaQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, campaign_id, next_action_at, next_action_channel, managed_by, profiles!leads_managed_by_fkey(full_name)")
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(100);
  if (filters.agent) agendaQuery.eq("managed_by", filters.agent);
  if (filters.campaign) agendaQuery.eq("campaign_id", filters.campaign);
  if (filters.status) agendaQuery.eq("status", filters.status);
  const { data: agendaLeads } = await agendaQuery;

  // Carga por ejecutivo agrupada en la base: contarla en memoria obligaba a
  // traer decenas de miles de filas y dejaba los números incompletos.
  const { data: loadRows, error: loadError } = await supabase.rpc("get_team_agent_load", {
    p_campaign_id: campaignScope || null,
  });
  if (loadError) console.error("[equipo] carga por ejecutivo:", loadError.message);

  // Compromisos vencidos: agendas que pasaron su hora sin cumplirse.
  const callbackQuery = supabase
    .from("leads")
    .select(
      "id, full_name, phone, campaign_id, next_action_at, callback_mode, callback_attempts, managed_by, assigned_to, campaigns!leads_campaign_id_fkey(name), profiles!leads_managed_by_fkey(full_name)"
    )
    .eq("workflow_status", "callback")
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(300);
  if (filters.campaign) callbackQuery.eq("campaign_id", filters.campaign);
  if (filters.agent) callbackQuery.eq("managed_by", filters.agent);
  if (filters.status) callbackQuery.eq("status", filters.status);
  const { data: callbackRows } = await callbackQuery;

  const now = new Date();
  const agendaRows = (agendaLeads ?? []) as AgendaLead[];
  const overdueAgenda = agendaRows.filter((lead) => new Date(lead.next_action_at!) <= now);
  const upcomingAgenda = agendaRows.filter((lead) => new Date(lead.next_action_at!) > now);
  const unassigned = (leads ?? []).filter((lead) => !lead.assigned_to).length;
  const activeAgents = (agents ?? []) as AgentOption[];
  const reportSummary = teamReport as TeamReportSummary | null;
  const reportedAgents = reportSummary?.agents ?? [];
  const reportedAgentsCount = reportedAgents.length || activeAgents.length;
  const historicalAgentsCount = reportedAgents.filter((agent) => agent.is_historical_only).length;
  const reportKpis = reportSummary?.kpis;
  const visibleBaseTotal = reportKpis?.base_total ?? (leads ?? []).length;
  const visibleUnassigned = reportKpis?.sin_asignar ?? unassigned;
  const visibleOverdue = reportKpis?.agendas_vencidas ?? overdueAgenda.length;

  const agentRows: TeamAgentRow[] = (
    (loadRows ?? []) as {
      profile_id: string;
      full_name: string;
      assigned: number;
      unmanaged: number;
      today: number;
      overdue: number;
    }[]
  ).map((row) => ({
    id: row.profile_id,
    full_name: row.full_name,
    assigned: Number(row.assigned),
    unmanaged: Number(row.unmanaged),
    today: Number(row.today),
    overdue: Number(row.overdue),
  }));

  const nowMs = now.getTime();
  const callbacks: CallbackRow[] = (callbackRows ?? []).map((lead) => {
    const owner = one(lead.profiles as ProfileEmbed);
    const campaign = one(lead.campaigns as { name: string } | { name: string }[] | null);
    return {
      id: lead.id,
      full_name: lead.full_name,
      phone: lead.phone,
      campaign: campaign?.name ?? null,
      owner_id: lead.managed_by ?? lead.assigned_to ?? null,
      owner_name: owner?.full_name ?? "Sin responsable",
      next_action_at: lead.next_action_at!,
      attempts: lead.callback_attempts ?? 0,
      mode: (lead.callback_mode ?? "personal") as "personal" | "campaign",
      overdue_minutes: Math.floor((nowMs - new Date(lead.next_action_at!).getTime()) / 60000),
    };
  });

  const overdueCallbacks = callbacks.filter((row) => row.overdue_minutes > 0).length;

  const assignmentRows: TeamLeadRow[] = (leads ?? []).map((lead) => ({
    id: lead.id,
    full_name: lead.full_name,
    rut: lead.rut,
    status: lead.status,
    assigned_to: lead.assigned_to,
    assigned_name: one(lead.profiles as ProfileEmbed)?.full_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Mi equipo"
        description="Reparte registros, corrige agendas vencidas y vigila la carga de tus ejecutivos."
        meta={
          <>
            <span>
              {activeAgents.length} {activeAgents.length === 1 ? "ejecutivo activo" : "ejecutivos activos"}
            </span>
            {overdueCallbacks > 0 && <Badge tone="danger">{overdueCallbacks} compromisos vencidos</Badge>}
          </>
        }
      />
      <NavTabs
        tabs={[
          { label: "Operación", href: "/dashboard/team" },
          { label: "Usuarios", href: "/dashboard/team/usuarios" },
        ]}
      />

      {/* El color solo aparece cuando hay algo que atender: un cero va gris. */}
      <KpiStrip columns={4}>
        <KpiStripItem
          label="Ejecutivos"
          icon={Users}
          value={reportedAgentsCount.toLocaleString("es-CL")}
          detail={`${activeAgents.length} activos para asignación${historicalAgentsCount ? ` · ${historicalAgentsCount} históricos` : ""}`}
          progress={percent(activeAgents.length, reportedAgentsCount)}
          href="/dashboard/team#carga"
        />
        <KpiStripItem
          label="Base del equipo"
          icon={Database}
          value={visibleBaseTotal.toLocaleString("es-CL")}
          detail="Registros visibles · barra: asignados"
          progress={percent(reportKpis?.asignados ?? 0, visibleBaseTotal)}
          href="/dashboard/leads"
        />
        <KpiStripItem
          label="Sin asignar"
          icon={UserPlus}
          value={visibleUnassigned.toLocaleString("es-CL")}
          tone={visibleUnassigned > 0 ? "warn" : "default"}
          detail="Disponible para repartir"
          progress={percent(visibleUnassigned, visibleBaseTotal)}
          href="/dashboard/leads?view=disponibles"
        />
        <KpiStripItem
          label="Agendas vencidas"
          icon={CalendarX2}
          value={visibleOverdue.toLocaleString("es-CL")}
          tone={visibleOverdue > 0 ? "danger" : "default"}
          detail="Compromisos a recuperar"
          href="/dashboard/leads?view=vencidas"
        />
      </KpiStrip>

      <FilterBar storageKey="equipo">
        <Field label="Ejecutivo" hideLabel className="w-52">
          <Select name="agent" defaultValue={filters.agent}>
            <option value="">Todos los ejecutivos</option>
            {(activeAgents as Option[]).map((option) => (
              <option key={option.id} value={option.id}>
                {option.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Campaña" hideLabel className="w-52">
          <Select name="campaign" defaultValue={filters.campaign}>
            <option value="">Todas las campañas</option>
            {((campaigns ?? []) as Option[]).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" hideLabel className="w-48">
          <Select name="status" defaultValue={filters.status}>
            <option value="">Todos los estados</option>
            {LEAD_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {/* Lo que el supervisor hace más seguido va primero, pegado a los filtros que lo acotan. */}
      <section className="space-y-3">
        <SectionHeading
          title="Asignación de registros"
          count={assignmentRows.length}
          description="Los movidos más recientemente. Selecciona varios y asígnalos de una vez, o reparte automáticamente según la carga de cada ejecutivo."
        />
        <TeamLeadsAssignment rows={assignmentRows} agents={activeAgents} />
      </section>

      <section className="space-y-3">
        <SectionHeading
          id="carga"
          title="Carga por ejecutivo"
          count={loadError ? undefined : agentRows.length}
          description="Quién está sobrecargado y quién puede recibir más trabajo. Abre a cualquiera para ver su cartera."
        />
        {loadError ? (
          <Callout tone="danger">No se pudo calcular la carga del equipo. Vuelve a cargar la página; si sigue igual, avisa a un administrador.</Callout>
        ) : (
          <TeamAgentsTable rows={agentRows} />
        )}
      </section>

      <SectionCard
        title="Campaña de cada ejecutivo"
        description="Ordena qué campaña se le disca primero a cada uno, o asígnale una y déjala fija: solo tú (o un admin) podrás cambiarla."
      >
        <div id="campanas" />
        {campaignBoardError ? (
          <div className="px-5 pb-5">
            <Callout tone="danger">No se pudo leer qué campaña tiene cada ejecutivo. Vuelve a cargar la página; si sigue igual, avisa a un administrador.</Callout>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <TeamCampaignControl rows={campaignBoard} viewerId={viewer.id} isAdmin={false} />
          </div>
        )}
      </SectionCard>

      <AgendaTable
        title="Agendas vencidas"
        description="Reasigna o corrige primero estas llamadas para recuperar SLA operativo."
        rows={overdueAgenda}
        agents={activeAgents}
        overdue
        emptyText="No hay agendas vencidas con estos filtros."
      />

      <AgendaTable
        title="Próximas agendas"
        description="Las que vienen, en orden de hora."
        rows={upcomingAgenda}
        agents={activeAgents}
        overdue={false}
        emptyText="No hay próximas agendas con estos filtros."
      />

      <section className="space-y-3">
        <SectionHeading
          title="Compromisos con clientes"
          count={callbacks.length}
          description={
            overdueCallbacks > 0
              ? `${overdueCallbacks} vencidos y ${callbacks.length - overdueCallbacks} por venir. Reagéndalos, traspásalos a otro ejecutivo o derívalos al discador para que los tome el primero disponible.`
              : `${callbacks.length} agendados, ninguno vencido. Acá puedes reagendar, traspasar a otro ejecutivo o derivar al discador.`
          }
        />
        <CallbacksPanel rows={callbacks} agents={activeAgents} />
      </section>
    </div>
  );
}
