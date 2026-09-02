import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { reassignAgenda } from "@/app/actions/admin";
import { LEAD_STATUSES } from "@/lib/types";
import Link from "next/link";
import {
  ActionForm,
  Button,
  FilterBar,
  Field,
  MetricCard,
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
import { CallbacksPanel, type CallbackRow } from "@/components/callbacks-panel";
import { REPORT_TIME_ZONE, toDateTimeInput } from "@/lib/report-range";
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

function formatAgendaDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: REPORT_TIME_ZONE,
  });
}

function agendaChannelLabel(channel: AgendaLead["next_action_channel"]): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "video_meeting") return "Videollamada";
  if (channel === "in_person") return "Presencial";
  return "Llamada";
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
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm">
        Reagendar
      </Button>
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
    <SectionCard title={title} description={description}>
      <Table>
        <Thead>
          <Th>Registro</Th>
          <Th>Ejecutivo</Th>
          <Th>Canal</Th>
          <Th>Agenda</Th>
          <Th>Reagendar</Th>
        </Thead>
        <Tbody>
          {rows.length === 0 && <TableEmpty colSpan={5}>{emptyText}</TableEmpty>}
          {rows.map((lead) => {
            const managerName = one(lead.profiles)?.full_name ?? "—";
            return (
              <Tr key={lead.id}>
                <Td strong>
                  <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-primary">
                    {lead.full_name}
                  </Link>
                </Td>
                <Td muted>{managerName}</Td>
                <Td muted>{agendaChannelLabel(lead.next_action_channel)}</Td>
                <Td className={overdue ? "font-medium text-danger" : "text-foreground"}>
                  {overdue ? "Vencida: " : ""}
                  {formatAgendaDateTime(lead.next_action_at!)}
                </Td>
                <Td>
                  <ReassignForm lead={lead} agents={agents} />
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </SectionCard>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; campaign?: string; status?: string }>;
}) {
  await requireProfile(["supervisor"]);
  const { agent, campaign, status } = await searchParams;
  const campaignScope = resolveCampaignScope(campaign);
  const supabase = await createClient();
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
        title="Mi equipo"
        description="Reparte registros, corrige agendas vencidas y vigila la carga de tus ejecutivos."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ejecutivos"
          href="/dashboard/team#carga"
          hrefLabel="Ver carga"
          value={reportedAgentsCount}
          hint={`${activeAgents.length} activos para asignación${historicalAgentsCount ? ` · ${historicalAgentsCount} históricos` : ""}`}
          progress={percent(activeAgents.length, reportedAgentsCount)}
          tone="good"
        />
        <MetricCard
          label="Base del equipo"
          value={visibleBaseTotal.toLocaleString("es-CL")}
          hint="Registros visibles para tu equipo"
          href="/dashboard/leads"
          hrefLabel="Ver registros"
          progress={percent(reportKpis?.asignados ?? 0, visibleBaseTotal)}
        />
        <MetricCard
          label="Sin asignar"
          value={visibleUnassigned.toLocaleString("es-CL")}
          hint="Disponible para repartir"
          href="/dashboard/leads?view=disponibles"
          hrefLabel="Ver disponibles"
          progress={percent(visibleUnassigned, visibleBaseTotal)}
          tone={visibleUnassigned > 0 ? "warn" : "good"}
        />
        <MetricCard
          label="Agendas vencidas"
          value={visibleOverdue.toLocaleString("es-CL")}
          hint="Compromisos a recuperar"
          href="/dashboard/leads?view=vencidas"
          hrefLabel="Ver vencidas"
          tone={visibleOverdue > 0 ? "danger" : "good"}
        />
      </div>

      <FilterBar storageKey="equipo">
        <Field label="Ejecutivo" className="w-48">
          <Select name="agent" defaultValue={filters.agent}>
            <option value="">Todos</option>
            {(activeAgents as Option[]).map((option) => (
              <option key={option.id} value={option.id}>
                {option.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Campaña" className="w-48">
          <Select name="campaign" defaultValue={filters.campaign}>
            <option value="">Todas</option>
            {((campaigns ?? []) as Option[]).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" className="w-44">
          <Select name="status" defaultValue={filters.status}>
            <option value="">Todos</option>
            {LEAD_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <div id="carga" />
      <SectionCard
        title="Carga por ejecutivo"
        description="Quién está sobrecargado y quién puede recibir más trabajo."
      >
        <div className="p-4">
          {loadError ? (
            <p className="text-sm text-danger">No se pudo calcular la carga del equipo: {loadError.message}</p>
          ) : (
            <TeamAgentsTable rows={agentRows} />
          )}
        </div>
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
        rows={upcomingAgenda}
        agents={activeAgents}
        overdue={false}
        emptyText="No hay próximas agendas con estos filtros."
      />

      <SectionCard
        title="Compromisos con clientes"
        description={
          overdueCallbacks > 0
            ? `${overdueCallbacks} vencidos y ${callbacks.length - overdueCallbacks} por venir. Reagéndalos, tráspasalos a otro ejecutivo o derívalos al discador para que los tome el primero disponible.`
            : `${callbacks.length} agendados, ninguno vencido. Acá puedes reagendar, traspasar a otro ejecutivo o derivar al discador.`
        }
      >
        <div className="p-4">
          <CallbacksPanel rows={callbacks} agents={activeAgents} />
        </div>
      </SectionCard>

      <SectionCard
        title="Asignación de registros"
        description={`Los ${assignmentRows.length} registros movidos más recientemente. Selecciona varios y asígnalos de una vez, o reparte automáticamente según la carga de cada ejecutivo.`}
      >
        <div className="p-4">
          <TeamLeadsAssignment rows={assignmentRows} agents={activeAgents} />
        </div>
      </SectionCard>
    </div>
  );
}
