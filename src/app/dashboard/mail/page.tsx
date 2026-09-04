import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  MailControlCenter,
  type MailControlBucket,
  type MailQueueRow,
} from "@/components/mail-control-center";
import { MailAgentControl } from "@/components/mail-agent-control";
import { MailWorkspace } from "@/components/mail-workspace";
import {
  Button,
  PageHeader,
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

type AgentOption = {
  id: string;
  full_name: string;
  email: string;
  team_id: string | null;
  campaign_ids: string[];
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
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail && <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function CampaignFilterForm({
  campaigns,
  selectedMailCampaignId,
  campaignId,
  campaignContextId,
  umbrella,
  compact = false,
}: {
  campaigns: MailCampaign[];
  selectedMailCampaignId: string | null;
  campaignId?: string | null;
  campaignContextId?: string | null;
  umbrella?: string | null;
  compact?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2">
      {campaignId && <input type="hidden" name="campaign" value={campaignId} />}
      {campaignContextId && <input type="hidden" name="campaignContext" value={campaignContextId} />}
      {umbrella && <input type="hidden" name="umbrella" value={umbrella} />}
      <Select
        name="mailCampaign"
        defaultValue={selectedMailCampaignId ?? ""}
        className={compact ? "w-72" : "w-64"}
      >
        <option value="">Todas las campañas de correo</option>
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

const MAIL_PAGE_SIZE = 25;
const MAIL_BUCKETS = new Set([
  "all",
  "overdue",
  "unassigned",
  "clicked_uncontacted",
  "opened_uncontacted",
  "next_action",
  "managed",
  "monitor",
]);

type MailCursor = {
  workRank: number;
  priorityRank: number;
  lastEventAt: string;
  leadId: string;
};

function decodeCursor(value: string | undefined): MailCursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as MailCursor;
    if (
      !Number.isInteger(cursor.workRank) ||
      !Number.isInteger(cursor.priorityRank) ||
      Number.isNaN(new Date(cursor.lastEventAt).getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cursor.leadId)
    ) {
      return null;
    }
    return cursor;
  } catch {
    return null;
  }
}

function encodeCursor(row: MailQueueRow): string {
  return Buffer.from(
    JSON.stringify({
      workRank: row.work_rank ?? 70,
      priorityRank: row.priority_rank,
      lastEventAt: row.last_event_at,
      leadId: row.lead_id,
    })
  ).toString("base64url");
}

function mailHref(
  mailCampaignId: string | null,
  bucket = "all",
  cursor?: string,
  campaignId?: string | null,
  campaignContextId?: string | null,
  umbrella?: string | null
): string {
  const params = new URLSearchParams();
  if (campaignId) params.set("campaign", campaignId);
  if (campaignContextId) params.set("campaignContext", campaignContextId);
  if (umbrella) params.set("umbrella", umbrella);
  if (mailCampaignId) params.set("mailCampaign", mailCampaignId);
  if (bucket !== "all") params.set("queue", bucket);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/dashboard/mail?${query}` : "/dashboard/mail";
}

async function fetchMailOperationalPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  selectedMailCampaignId: string | null,
  selectedCampaignId: string | null,
  bucket: string,
  cursor: MailCursor | null
) {
  const { data, error } = await supabase.rpc("get_mail_operational_queue_page", {
    p_mail_campaign_id: selectedMailCampaignId,
    p_campaign_id: selectedCampaignId,
    p_bucket: bucket,
    p_limit: MAIL_PAGE_SIZE + 1,
    p_after_work_rank: cursor?.workRank ?? null,
    p_after_priority_rank: cursor?.priorityRank ?? null,
    p_after_last_event_at: cursor?.lastEventAt ?? null,
    p_after_lead_id: cursor?.leadId ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<MailQueueRow & { work_bucket?: string; priority_reason?: string }>;
  return rows.map((item) => {
    return {
      ...item,
      queue_bucket: item.work_bucket ?? "monitor",
      attention_reason: item.priority_reason,
    };
  }) as MailQueueRow[];
}

export default async function MailDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    campaign?: string;
    campaignContext?: string;
    umbrella?: string;
    mailCampaign?: string;
    queue?: string;
    cursor?: string;
  }>;
}) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const {
    campaign,
    campaignContext,
    umbrella,
    mailCampaign,
    queue: queueParam,
    cursor: cursorParam,
  } = await searchParams;
  const selectedCampaignId = campaign || null;
  const selectedMailCampaignId = mailCampaign || null;
  const activeBucket = queueParam && MAIL_BUCKETS.has(queueParam) ? queueParam : "all";
  const cursor = decodeCursor(cursorParam);
  const supabase = await createClient();

  // La entrada general de Correo debe abrir una operación concreta. Ejecutar
  // los read models sin campaña obliga a consolidar todo el histórico mail y
  // puede superar el statement timeout de Postgres. La cola ya declara qué
  // campaña alimenta el canal email, por lo que reutilizamos esa relación
  // canónica en vez de inventar otra preferencia de navegación.
  if (!selectedCampaignId && !selectedMailCampaignId && !campaignContext && !umbrella) {
    const { data: emailSources, error: emailSourcesError } = await supabase
      .from("contact_center_queue_sources")
      .select("campaign_id")
      .eq("channel_type", "email")
      .eq("is_active", true)
      .not("campaign_id", "is", null)
      .limit(2);

    if (emailSourcesError) throw new Error(emailSourcesError.message);

    const emailCampaignIds = [
      ...new Set((emailSources ?? []).map((source) => source.campaign_id).filter(Boolean)),
    ];
    if (emailCampaignIds.length === 1) {
      redirect(`/dashboard/mail?campaign=${emailCampaignIds[0]}`);
    }
  }

  const { data: supervisedTeams } =
    profile.role === "supervisor"
      ? await supabase.from("teams").select("id").eq("supervisor_id", profile.id)
      : { data: [] as { id: string }[] };
  const supervisedTeamIds = (supervisedTeams ?? []).map((team) => team.id);

  const agentsQuery = supabase
    .from("profiles")
    .select("id, full_name, email, team_id")
    .eq("role", "agente")
    .eq("active", true)
    .order("full_name");

  if (profile.role === "supervisor") {
    if (supervisedTeamIds.length > 0) agentsQuery.in("team_id", supervisedTeamIds);
    else agentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  let mailCampaignsQuery = supabase
    .from("mail_campaigns")
    .select("id, name, campaign_id, umbrella_key, status")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (selectedCampaignId) mailCampaignsQuery = mailCampaignsQuery.eq("campaign_id", selectedCampaignId);
  if (umbrella) mailCampaignsQuery = mailCampaignsQuery.eq("umbrella_key", umbrella);

  const [
    { data: mailCampaigns },
    { data: selectedCampaign },
    { data: reportData, error: reportError },
    { data: agentSummaryData, error: agentSummaryError },
    { data: bucketData, error: bucketError },
    queueData,
    { data: agents, error: agentsError },
    { data: campaignMemberships, error: campaignMembershipsError },
  ] =
    await Promise.all([
      mailCampaignsQuery,
      selectedCampaignId || campaignContext
        ? supabase.from("campaigns").select("id,name").eq("id", selectedCampaignId ?? campaignContext).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc("get_mail_engagement_report_read_model", {
        p_mail_campaign_id: selectedMailCampaignId,
        p_campaign_id: selectedCampaignId,
      }),
      supabase.rpc("get_mail_agent_control_summary_read_model", {
        p_mail_campaign_id: selectedMailCampaignId,
        p_campaign_id: selectedCampaignId,
      }),
      supabase.rpc("get_mail_operational_bucket_summary", {
        p_mail_campaign_id: selectedMailCampaignId,
        p_campaign_id: selectedCampaignId,
      }),
      fetchMailOperationalPage(supabase, selectedMailCampaignId, selectedCampaignId, activeBucket, cursor),
      agentsQuery,
      supabase.from("campaign_agents").select("campaign_id, profile_id"),
    ]);

  if (reportError) throw new Error(reportError.message);
  if (agentSummaryError) throw new Error(agentSummaryError.message);
  if (bucketError) throw new Error(bucketError.message);
  if (agentsError) throw new Error(agentsError.message);
  if (campaignMembershipsError) throw new Error(campaignMembershipsError.message);

  const campaigns = (mailCampaigns ?? []) as MailCampaign[];
  const reports = (reportData ?? []) as MailReportRow[];
  const queueLeadIds = [...new Set(queueData.slice(0, MAIL_PAGE_SIZE).map((row) => row.lead_id))];
  const { data: queueLeadTeams, error: queueLeadTeamsError } = queueLeadIds.length > 0
    ? await supabase.from("leads").select("id,team_id").in("id", queueLeadIds)
    : { data: [] as Array<{ id: string; team_id: string | null }>, error: null };
  if (queueLeadTeamsError) throw new Error(queueLeadTeamsError.message);
  const teamIdByLead = new Map((queueLeadTeams ?? []).map((lead) => [lead.id, lead.team_id]));
  const queue = queueData.slice(0, MAIL_PAGE_SIZE).map((row) => ({
    ...row,
    team_id: teamIdByLead.get(row.lead_id) ?? null,
  }));
  const hasMoreQueue = queueData.length > MAIL_PAGE_SIZE;
  const agentSummary = (agentSummaryData ?? []) as MailAgentSummary[];
  const bucketSummary = (bucketData ?? []) as Array<{
    bucket: string;
    label: string;
    sort_order: number;
    lead_count: number;
    oldest_event_at: string | null;
    nearest_action_at: string | null;
  }>;
  const campaignIdsByAgent = new Map<string, string[]>();
  for (const membership of campaignMemberships ?? []) {
    campaignIdsByAgent.set(membership.profile_id, [
      ...(campaignIdsByAgent.get(membership.profile_id) ?? []),
      membership.campaign_id,
    ]);
  }
  const agentOptions = (agents ?? []).map((agent) => ({
    ...agent,
    campaign_ids: campaignIdsByAgent.get(agent.id) ?? [],
  })) as AgentOption[];
  const agentSummaryById = new Map(agentSummary.map((row) => [row.agent_id, row]));
  const activeAgentIds = new Set(agentOptions.map((agent) => agent.id));
  const historicalAgentRows = agentSummary.filter((row) => !activeAgentIds.has(row.agent_id));
  const agentSummaryForDisplay = [
    ...agentOptions.map(
      (agent) => ({
        ...(agentSummaryById.get(agent.id) ?? {
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
        }),
        is_active: true,
      })
    ),
    ...historicalAgentRows.map((row) => ({ ...row, is_active: false })),
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
  const totalPrioritized = selectedMailCampaignId ? reports[0]?.hot_leads ?? 0 : totals.hot;
  const nextQueueHref = hasMoreQueue && queue.length > 0
    ? mailHref(selectedMailCampaignId, activeBucket, encodeCursor(queue[queue.length - 1]), selectedCampaignId, campaignContext, umbrella)
    : null;
  const resetQueueHref = mailHref(selectedMailCampaignId, activeBucket, undefined, selectedCampaignId, campaignContext, umbrella);
  const bucketTone: Record<string, MailControlBucket["tone"]> = {
    overdue: "danger",
    unassigned: "warning",
    clicked_uncontacted: "warning",
    opened_uncontacted: "info",
    next_action: "info",
    managed: "success",
    monitor: "neutral",
  };
  const buckets: MailControlBucket[] = [
    {
      id: "all",
      label: "Toda la cola",
      count: totalPrioritized,
      description: "Visión completa, ordenada por urgencia",
      href: mailHref(selectedMailCampaignId, "all", undefined, selectedCampaignId, campaignContext, umbrella),
      tone: "info",
    },
    ...bucketSummary
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((bucket) => ({
        id: bucket.bucket,
        label: bucket.label,
        count: bucket.lead_count,
        description: bucket.nearest_action_at
          ? `Próxima acción ${formatDate(bucket.nearest_action_at)}`
          : bucket.oldest_event_at
            ? `Señal más antigua ${formatDate(bucket.oldest_event_at)}`
            : "Sin oportunidades en esta prioridad",
        href: mailHref(selectedMailCampaignId, bucket.bucket, undefined, selectedCampaignId, campaignContext, umbrella),
        tone: bucketTone[bucket.bucket] ?? "neutral",
      })),
  ];
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
        title={selectedCampaign ? `Correo · ${selectedCampaign.name}` : "Correo"}
        description="Cola de correo saliente: aperturas y clicks listos para asignación y seguimiento."
        actions={
          <CampaignFilterForm
            campaigns={campaigns}
            selectedMailCampaignId={selectedMailCampaignId}
            campaignId={selectedCampaignId}
            campaignContextId={campaignContext}
            umbrella={umbrella}
          />
        }
      />

      <MailWorkspace
        attentionCount={agentTotals.overdue + agentTotals.clickedUncontacted + agentTotals.noNextAction}
        operation={<MailControlCenter rows={queue} agents={agentOptions} buckets={buckets} activeBucket={activeBucket} total={totalPrioritized} nextHref={nextQueueHref} resetHref={resetQueueHref} />}
        team={<MailAgentControl rows={agentSummaryForDisplay} />}
        reports={
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Enviados" value={formatNumber(totals.sent)} />
              <MetricCard label="Aperturas" value={formatNumber(totals.opened)} detail={percent(totals.opened, totals.sent)} />
              <MetricCard label="Clicks" value={formatNumber(totals.clicked)} detail={percent(totals.clicked, totals.sent)} />
              <MetricCard label="Priorizados" value={formatNumber(totals.hot)} detail="Apertura o click" />
              <MetricCard label="Asignados" value={formatNumber(totals.assigned)} detail={percent(totals.assigned, totals.hot)} />
              <MetricCard label="Gestionados" value={formatNumber(totals.managed)} detail={percent(totals.managed, totals.hot)} />
            </div>
            <div className="max-h-[34rem] overflow-auto">
              <Table>
                <Thead><Th>Campaña mail</Th><Th>CRM</Th><Th>Enviados</Th><Th>Aperturas</Th><Th>Clicks</Th><Th>Asignados</Th><Th>Última señal</Th></Thead>
                <Tbody>
                  {reports.length === 0 && <TableEmpty colSpan={7}>Sin señales mail para el filtro seleccionado.</TableEmpty>}
                  {reports.map((row) => <Tr key={`${row.mail_campaign_id ?? row.campaign_id}-${row.campaign_id}`}><Td strong>{row.mail_campaign_name}</Td><Td muted>{row.campaign_name}</Td><Td muted>{formatNumber(row.sent_leads)}</Td><Td muted>{formatNumber(row.opened_leads)}</Td><Td muted>{formatNumber(row.clicked_leads)}</Td><Td muted>{formatNumber(row.assigned_hot_leads)} / {formatNumber(row.hot_leads)}</Td><Td muted>{formatDate(row.last_event_at)}</Td></Tr>)}
                </Tbody>
              </Table>
            </div>
          </section>
        }
      />
    </div>
  );
}
