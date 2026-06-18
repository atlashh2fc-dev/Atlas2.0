import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AgentPerformance, WorkflowCompliance, CampaignDashboardCall } from "@/lib/types";
import { CampaignDashboard } from "@/components/campaign-dashboard";

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;
type LeadEmbed =
  | { full_name: string; campaign_id: string | null }
  | { full_name: string; campaign_id: string | null }[]
  | null;

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  await requireProfile(["supervisor", "admin"]);
  const { campaign: campaignParam } = await searchParams;
  const supabase = await createClient();

  const { data: agentPerf } = await supabase
    .from("agent_performance")
    .select("*")
    .order("total_interactions", { ascending: false });

  const { data: workflowCompliance } = await supabase.rpc("get_workflow_compliance");

  const { data: campaignList } = await supabase
    .from("campaigns")
    .select("id, name")
    .order("name");

  const agents = (agentPerf ?? []) as AgentPerformance[];
  const workflows = (workflowCompliance ?? []) as WorkflowCompliance[];
  const campaigns = campaignList ?? [];

  const selectedCampaignId = campaignParam || campaigns[0]?.id || null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;

  let dashboardCalls: CampaignDashboardCall[] = [];
  let dashboardLeadCount = 0;
  let dashboardAgentOptions: { id: string; name: string }[] = [];

  if (selectedCampaignId) {
    const [{ data: rawCalls, error: callsError }, { count: leadCount }, { data: agentMembers }] =
      await Promise.all([
        supabase
          .from("calls")
          .select(
            `id, status, outcome, reason, equifax_products, equifax_uf_amount, next_action_at, started_at, ended_at,
             agent_id, profiles!calls_agent_id_fkey(full_name),
             lead_id, leads!inner(full_name, campaign_id)`
          )
          .eq("leads.campaign_id", selectedCampaignId)
          .order("started_at", { ascending: true }),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", selectedCampaignId),
        supabase
          .from("campaign_agents")
          .select("profile_id, profiles(full_name)")
          .eq("campaign_id", selectedCampaignId),
      ]);

    if (callsError) throw new Error(callsError.message);

    dashboardCalls = (rawCalls ?? []).map((row) => {
      const profile = one(row.profiles as ProfileEmbed);
      const lead = one(row.leads as LeadEmbed);
      return {
        id: row.id,
        status: row.status,
        outcome: row.outcome,
        reason: row.reason,
        equifax_products: row.equifax_products,
        equifax_uf_amount: row.equifax_uf_amount,
        next_action_at: row.next_action_at,
        started_at: row.started_at,
        ended_at: row.ended_at,
        agent_id: row.agent_id,
        agent_name: profile?.full_name ?? "—",
        lead_id: row.lead_id,
        lead_full_name: lead?.full_name ?? "—",
      };
    });

    dashboardLeadCount = leadCount ?? 0;
    dashboardAgentOptions = (agentMembers ?? [])
      .map((m) => {
        const profile = one(m.profiles as ProfileEmbed);
        return profile ? { id: m.profile_id as string, name: profile.full_name } : null;
      })
      .filter((a): a is { id: string; name: string } => a !== null);
  }

  const totals = agents.reduce(
    (acc, a) => {
      acc.interactions += a.total_interactions;
      acc.leads += a.leads_managed;
      acc.conversions += a.conversions;
      return acc;
    },
    { interactions: 0, leads: 0, conversions: 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Rendimiento por ejecutivo y cumplimiento de flujos de gestión.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Gestiones totales</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.interactions}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Leads gestionados</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.leads}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-xs text-muted-foreground">Conversiones</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{totals.conversions}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Rendimiento por ejecutivo</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Ejecutivo</th>
                <th className="px-5 py-3 font-medium">Equipo</th>
                <th className="px-5 py-3 font-medium">Gestiones</th>
                <th className="px-5 py-3 font-medium">Leads gestionados</th>
                <th className="px-5 py-3 font-medium">Conversiones</th>
                <th className="px-5 py-3 font-medium">Tiempo prom. 1ra gestión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                    Sin datos todavía.
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.agent_id}>
                  <td className="px-5 py-3 font-medium text-foreground">{a.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.team_name ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.total_interactions}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.leads_managed}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.conversions}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {formatDuration(a.avg_first_response_seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Cumplimiento de flujos</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Flujo</th>
                <th className="px-5 py-3 font-medium">Leads asignados</th>
                <th className="px-5 py-3 font-medium">Cumplimiento completo</th>
                <th className="px-5 py-3 font-medium">% cumplimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workflows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                    No hay flujos configurados.
                  </td>
                </tr>
              )}
              {workflows.map((w) => (
                <tr key={w.workflow_id}>
                  <td className="px-5 py-3 font-medium text-foreground">{w.workflow_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{w.total_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">{w.compliant_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {w.compliance_rate !== null ? `${w.compliance_rate}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Dashboard de campaña</h2>
          {campaigns.length > 0 && (
            <form className="flex items-center gap-2">
              <select
                name="campaign"
                defaultValue={selectedCampaignId ?? ""}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Ver
              </button>
            </form>
          )}
        </div>

        {campaigns.length === 0 && (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            No hay campañas configuradas.
          </div>
        )}

        {selectedCampaign && (
          <CampaignDashboard
            key={selectedCampaign.id}
            calls={dashboardCalls}
            totalLeads={dashboardLeadCount}
            agentOptions={dashboardAgentOptions}
          />
        )}
      </div>
    </div>
  );
}
