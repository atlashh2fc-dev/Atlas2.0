import Link from "next/link";

import { assignMailEngagementLead } from "@/app/actions/mail";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Badge,
  Button,
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

type MailCampaign = {
  id: string;
  name: string;
  campaign_id: string;
  umbrella_key: string;
  status: string;
};

type MailReportRow = {
  mail_campaign_id: string | null;
  mail_campaign_name: string;
  campaign_id: string;
  campaign_name: string;
  sent_leads: number;
  delivered_leads: number;
  opened_leads: number;
  clicked_leads: number;
  hot_leads: number;
  assigned_hot_leads: number;
  managed_hot_leads: number;
  last_event_at: string | null;
};

type MailQueueRow = {
  mail_campaign_id: string | null;
  mail_campaign_name: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  team_id: string | null;
  opened: boolean;
  clicked: boolean;
  last_event_at: string;
  priority_rank: number;
  priority_reason: string;
};

type AgentOption = {
  id: string;
  full_name: string;
  email: string;
};

type MailAgentSummary = {
  agent_id: string;
  agent_name: string;
  assigned_leads: number;
  clicked_leads: number;
  opened_only_leads: number;
  uncontacted_leads: number;
  clicked_uncontacted_leads: number;
  contacted_leads: number;
  interactions: number;
  agendas: number;
  pending_agendas: number;
  overdue_agendas: number;
  no_next_action_leads: number;
  next_agenda_at: string | null;
  last_interaction_at: string | null;
  last_event_at: string | null;
};

function formatNumber(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)).toLocaleString("es-CL");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function percent(part: number, total: number) {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toLocaleString("es-CL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function CampaignFilterForm({
  campaigns,
  selectedMailCampaignId,
  compact = false,
}: {
  campaigns: MailCampaign[];
  selectedMailCampaignId: string | null;
  compact?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      <Select
        name="mailCampaign"
        defaultValue={selectedMailCampaignId ?? ""}
        className={compact ? "w-72" : "w-64"}
      >
        <option value="">Todas las campañas mail Equifax</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
    </form>
  );
}

async function fetchMailEngagementQueue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  selectedMailCampaignId: string | null
) {
  const pageSize = 1000;
  const rows: MailQueueRow[] = [];

  for (let offset = 0; offset < 20000; offset += pageSize) {
    const { data, error } = await supabase.rpc("get_mail_engagement_queue", {
      p_mail_campaign_id: selectedMailCampaignId,
      p_campaign_id: null,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) throw new Error(error.message);

    const page = (data ?? []) as MailQueueRow[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

export default async function MailDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mailCampaign?: string }>;
}) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { mailCampaign } = await searchParams;
  const selectedMailCampaignId = mailCampaign || null;
  const supabase = await createClient();

  const agentsQuery = supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "agente")
    .eq("active", true)
    .order("full_name");

  if (profile.role === "supervisor") {
    if (profile.team_id) agentsQuery.eq("team_id", profile.team_id);
    else agentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const [
    { data: mailCampaigns },
    { data: reportData, error: reportError },
    { data: agentSummaryData, error: agentSummaryError },
    queueData,
    { data: agents },
  ] =
    await Promise.all([
      supabase
        .from("mail_campaigns")
        .select("id, name, campaign_id, umbrella_key, status")
        .eq("umbrella_key", "equifax")
        .order("updated_at", { ascending: false }),
      supabase.rpc("get_mail_engagement_report", {
        p_mail_campaign_id: selectedMailCampaignId,
        p_campaign_id: null,
      }),
      supabase.rpc("get_mail_agent_control_summary", {
        p_mail_campaign_id: selectedMailCampaignId,
        p_campaign_id: null,
      }),
      fetchMailEngagementQueue(supabase, selectedMailCampaignId),
      agentsQuery,
    ]);

  if (reportError) throw new Error(reportError.message);
  if (agentSummaryError) throw new Error(agentSummaryError.message);

  const campaigns = (mailCampaigns ?? []) as MailCampaign[];
  const reports = (reportData ?? []) as MailReportRow[];
  const queue = queueData;
  const agentSummary = (agentSummaryData ?? []) as MailAgentSummary[];
  const agentOptions = (agents ?? []) as AgentOption[];
  const agentSummaryById = new Map(agentSummary.map((row) => [row.agent_id, row]));
  const activeAgentIds = new Set(agentOptions.map((agent) => agent.id));
  const historicalAgentRows = agentSummary.filter((row) => !activeAgentIds.has(row.agent_id));
  const agentSummaryForDisplay = [
    ...agentOptions.map(
      (agent) =>
        agentSummaryById.get(agent.id) ?? {
          agent_id: agent.id,
          agent_name: agent.full_name ?? agent.email ?? "Ejecutivo sin nombre",
          assigned_leads: 0,
          clicked_leads: 0,
          opened_only_leads: 0,
          uncontacted_leads: 0,
          clicked_uncontacted_leads: 0,
          contacted_leads: 0,
          interactions: 0,
          agendas: 0,
          pending_agendas: 0,
          overdue_agendas: 0,
          no_next_action_leads: 0,
          next_agenda_at: null,
          last_interaction_at: null,
          last_event_at: null,
        }
    ),
    ...historicalAgentRows,
  ].sort((left, right) => {
    if (right.assigned_leads !== left.assigned_leads) return right.assigned_leads - left.assigned_leads;
    if (right.clicked_uncontacted_leads !== left.clicked_uncontacted_leads) {
      return right.clicked_uncontacted_leads - left.clicked_uncontacted_leads;
    }
    return left.agent_name.localeCompare(right.agent_name, "es");
  });

  const totals = reports.reduce(
    (acc, row) => {
      acc.sent += row.sent_leads;
      acc.opened += row.opened_leads;
      acc.clicked += row.clicked_leads;
      acc.hot += row.hot_leads;
      acc.assigned += row.assigned_hot_leads;
      acc.managed += row.managed_hot_leads;
      return acc;
    },
    { sent: 0, opened: 0, clicked: 0, hot: 0, assigned: 0, managed: 0 }
  );
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedMailCampaignId) ?? null;
  const selectedDetail = selectedMailCampaignId ? reports[0] ?? null : null;
  const latestReportEventAt = reports.reduce<string | null>((latest, row) => {
    if (!row.last_event_at) return latest;
    if (!latest || new Date(row.last_event_at) > new Date(latest)) return row.last_event_at;
    return latest;
  }, null);
  const unassignedHotLeads = queue.filter((row) => !row.assigned_to).length;
  const agentTotals = agentSummary.reduce(
    (acc, row) => {
      acc.assigned += row.assigned_leads;
      acc.clicked += row.clicked_leads;
      acc.contacted += row.contacted_leads;
      acc.uncontacted += row.uncontacted_leads;
      acc.clickedUncontacted += row.clicked_uncontacted_leads;
      acc.interactions += row.interactions;
      acc.agendas += row.agendas;
      acc.pending += row.pending_agendas;
      acc.overdue += row.overdue_agendas;
      acc.noNextAction += row.no_next_action_leads;
      return acc;
    },
    { assigned: 0, clicked: 0, contacted: 0, uncontacted: 0, clickedUncontacted: 0, interactions: 0, agendas: 0, pending: 0, overdue: 0, noNextAction: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads de campañas mail"
        description="Contenedor operativo Equifax: solo leads con apertura o click, listos para asignación manual."
        actions={<CampaignFilterForm campaigns={campaigns} selectedMailCampaignId={selectedMailCampaignId} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Enviados" value={formatNumber(totals.sent)} />
        <MetricCard label="Aperturas" value={formatNumber(totals.opened)} detail={percent(totals.opened, totals.sent)} />
        <MetricCard label="Clicks" value={formatNumber(totals.clicked)} detail={percent(totals.clicked, totals.sent)} />
        <MetricCard label="Priorizados" value={formatNumber(totals.hot)} detail="Apertura o click" />
        <MetricCard label="Asignados" value={formatNumber(totals.assigned)} detail={percent(totals.assigned, totals.hot)} />
        <MetricCard label="Gestionados" value={formatNumber(totals.managed)} detail={percent(totals.managed, totals.hot)} />
      </div>

      <SectionCard title="Reportería por campaña mail">
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Campaña mail</Th>
              <Th>CRM</Th>
              <Th>Enviados</Th>
              <Th>Aperturas</Th>
              <Th>Clicks</Th>
              <Th>Asignados</Th>
              <Th>Última señal</Th>
            </Thead>
            <Tbody>
              {reports.length === 0 && (
                <TableEmpty colSpan={7}>Sin señales mail para el filtro seleccionado.</TableEmpty>
              )}
              {reports.map((row) => (
                <Tr key={`${row.mail_campaign_id ?? row.campaign_id}-${row.campaign_id}`}>
                  <Td strong>{row.mail_campaign_name}</Td>
                  <Td muted>{row.campaign_name}</Td>
                  <Td muted>{formatNumber(row.sent_leads)}</Td>
                  <Td muted>{formatNumber(row.opened_leads)}</Td>
                  <Td muted>{formatNumber(row.clicked_leads)}</Td>
                  <Td muted>
                    {formatNumber(row.assigned_hot_leads)} / {formatNumber(row.hot_leads)}
                  </Td>
                  <Td muted>{formatDate(row.last_event_at)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </SectionCard>

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Leads con apertura o click</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedCampaign ? selectedCampaign.name : "Todas las campañas mail Equifax"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                {formatNumber(selectedDetail?.hot_leads ?? totals.hot)} priorizados
              </span>
              <span className={`rounded-full border px-3 py-1 ${unassignedHotLeads > 0 ? "border-warning/30 bg-warning-bg text-warning" : "border-success/30 bg-success-bg text-success"}`}>
                {formatNumber(unassignedHotLeads)} sin asignar
              </span>
              <span className="rounded-full border border-border bg-background px-3 py-1 text-muted-foreground">
                Última señal {formatDate(selectedDetail?.last_event_at ?? latestReportEventAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-background/40 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Control por ejecutivo</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Seguimiento de leads Atlas mail gestionados o asignados{selectedCampaign ? ` en ${selectedCampaign.name}` : " en todas las campañas"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-muted-foreground">
                {formatNumber(agentOptions.length)} ejecutivo{agentOptions.length === 1 ? "" : "s"} activo{agentOptions.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-muted-foreground">
                {formatNumber(agentSummary.length)} con carga mail
              </span>
              {historicalAgentRows.length > 0 && (
                <span className="rounded-full border border-border bg-surface px-3 py-1 text-muted-foreground">
                  {formatNumber(historicalAgentRows.length)} histórico{historicalAgentRows.length === 1 ? "" : "s"}
                </span>
              )}
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-muted-foreground">
                {formatNumber(agentTotals.assigned)} gestionados/asignados
              </span>
              <span className={`rounded-full border px-3 py-1 ${agentTotals.clickedUncontacted > 0 ? "border-warning/30 bg-warning-bg text-warning" : "border-success/30 bg-success-bg text-success"}`}>
                {formatNumber(agentTotals.clickedUncontacted)} clicks sin contacto
              </span>
              <span className={`rounded-full border px-3 py-1 ${unassignedHotLeads > 0 ? "border-warning/30 bg-warning-bg text-warning" : "border-success/30 bg-success-bg text-success"}`}>
                {formatNumber(unassignedHotLeads)} sin asignar
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted-foreground">Contactados</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNumber(agentTotals.contacted)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {percent(agentTotals.contacted, agentTotals.assigned)} de asignados · {formatNumber(agentTotals.uncontacted)} sin contacto
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted-foreground">Gestiones CRM</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNumber(agentTotals.interactions)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Interacciones registradas sobre leads mail</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted-foreground">Agendas pendientes</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNumber(agentTotals.pending)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(agentTotals.noNextAction)} asignados sin próxima acción
              </p>
            </div>
            <div className={`rounded-lg border p-4 ${agentTotals.overdue > 0 ? "border-danger/30 bg-danger-bg" : "border-success/30 bg-success-bg"}`}>
              <p className={`text-xs ${agentTotals.overdue > 0 ? "text-danger" : "text-success"}`}>Agendas vencidas</p>
              <p className={`mt-1 text-2xl font-semibold ${agentTotals.overdue > 0 ? "text-danger" : "text-success"}`}>
                {formatNumber(agentTotals.overdue)}
              </p>
              <p className={`mt-1 text-xs ${agentTotals.overdue > 0 ? "text-danger" : "text-success"}`}>
                {agentTotals.overdue > 0 ? "Prioridad de recuperación" : "Sin atraso operativo"}
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
            <Table>
              <Thead>
                <Th>Ejecutivo</Th>
                <Th>Leads mail</Th>
                <Th>Señales</Th>
                <Th>Contactos</Th>
                <Th>Agendas</Th>
                <Th>Seguimiento</Th>
              </Thead>
              <Tbody>
                {agentSummaryForDisplay.length === 0 && (
                  <TableEmpty colSpan={6}>
                    No hay ejecutivos con gestión mail para este filtro.
                  </TableEmpty>
                )}
                {agentSummaryForDisplay.map((row) => {
                  const contactRate = row.assigned_leads > 0 ? row.contacted_leads / row.assigned_leads : 0;
                  const attentionLabel =
                    row.assigned_leads === 0
                      ? "Sin asignación mail"
                      : row.overdue_agendas > 0
                        ? "Agendas vencidas"
                        : row.clicked_uncontacted_leads > 0
                          ? "Clicks sin contacto"
                          : contactRate < 0.5
                            ? "Bajo contacto"
                            : row.no_next_action_leads > 0
                              ? "Sin próxima acción"
                              : "En seguimiento";
                  const needsAttention = attentionLabel !== "En seguimiento" && attentionLabel !== "Sin asignación mail";
                  return (
                    <Tr key={row.agent_id}>
                      <Td>
                        <p className="font-medium text-foreground">{row.agent_name}</p>
                        <p className="text-xs text-muted-foreground">Última señal mail: {formatDate(row.last_event_at)}</p>
                        <p className="text-xs text-muted-foreground">Última gestión CRM: {formatDate(row.last_interaction_at)}</p>
                      </Td>
                      <Td>
                        <p className="font-semibold text-foreground">{formatNumber(row.assigned_leads)}</p>
                        <p className="text-xs text-muted-foreground">{percent(row.assigned_leads, agentTotals.assigned)} de asignados</p>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="success">{formatNumber(row.clicked_leads)} clicks</Badge>
                          <Badge tone="warning">{formatNumber(row.opened_only_leads)} aperturas sin click</Badge>
                        </div>
                      </Td>
                      <Td>
                        <p className="font-semibold text-foreground">{formatNumber(row.contacted_leads)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(row.interactions)} gestiones · {percent(row.contacted_leads, row.assigned_leads)}
                        </p>
                        {row.clicked_uncontacted_leads > 0 && (
                          <p className="text-xs font-medium text-warning">{formatNumber(row.clicked_uncontacted_leads)} clicks sin contacto</p>
                        )}
                      </Td>
                      <Td>
                        <p className="font-semibold text-foreground">{formatNumber(row.pending_agendas)} pendientes</p>
                        <p className={row.overdue_agendas > 0 ? "text-xs font-medium text-danger" : "text-xs text-muted-foreground"}>
                          {formatNumber(row.overdue_agendas)} vencidas · próxima {formatDate(row.next_agenda_at)}
                        </p>
                        {row.no_next_action_leads > 0 && (
                          <p className="text-xs text-muted-foreground">{formatNumber(row.no_next_action_leads)} sin próxima acción</p>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            attentionLabel === "Sin asignación mail"
                              ? "neutral"
                              : needsAttention
                                ? "warning"
                                : "success"
                          }
                        >
                          {attentionLabel}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Lead</Th>
              <Th>Señal</Th>
              <Th>Campaña</Th>
              <Th>Asignado</Th>
              <Th>Asignar</Th>
            </Thead>
            <Tbody>
              {queue.length === 0 && (
                <TableEmpty colSpan={5}>No hay leads con apertura o click para asignar.</TableEmpty>
              )}
              {queue.map((row) => (
                <Tr key={`${row.mail_campaign_id ?? row.campaign_id}-${row.lead_id}`}>
                  <Td>
                    <Link href={`/dashboard/leads/${row.lead_id}`} className="font-medium text-foreground hover:text-primary">
                      {row.full_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.rut ?? "Sin RUT"} · {row.phone ?? row.email ?? "Sin contacto"}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {row.clicked && <Badge tone="success">Click</Badge>}
                      {row.opened && <Badge tone="warning">Apertura</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.last_event_at)}</p>
                  </Td>
                  <Td muted>
                    <p>{row.mail_campaign_name}</p>
                    <p className="text-xs">{row.campaign_name}</p>
                  </Td>
                  <Td muted>{row.assigned_to_name ?? "Sin asignar"}</Td>
                  <Td>
                    <form action={assignMailEngagementLead} className="flex min-w-72 items-center gap-2">
                      <input type="hidden" name="lead_id" value={row.lead_id} />
                      <input type="hidden" name="mail_campaign_id" value={row.mail_campaign_id ?? ""} />
                      <Select
                        name="agent_id"
                        fieldSize="sm"
                        defaultValue={row.assigned_to ?? ""}
                        required
                        className="min-w-0 flex-1"
                      >
                        <option value="" disabled>
                          Ejecutivo
                        </option>
                        {agentOptions.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.full_name}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" size="sm">
                        Asignar
                      </Button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}
