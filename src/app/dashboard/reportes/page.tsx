import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AgentPerformance, WorkflowCompliance, CampaignPerformance } from "@/lib/types";

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function ReportesPage() {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();

  const { data: agentPerf } = await supabase
    .from("agent_performance")
    .select("*")
    .order("total_interactions", { ascending: false });

  const { data: workflowCompliance } = await supabase
    .from("workflow_compliance")
    .select("*")
    .order("workflow_name");

  const { data: campaignPerf } = await supabase
    .from("campaign_performance")
    .select("*")
    .order("campaign_name");

  const agents = (agentPerf ?? []) as AgentPerformance[];
  const workflows = (workflowCompliance ?? []) as WorkflowCompliance[];
  const campaigns = (campaignPerf ?? []) as CampaignPerformance[];

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
        <h2 className="mb-3 text-sm font-semibold text-foreground">Rendimiento por campaña</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Campaña</th>
                <th className="px-5 py-3 font-medium">Flujo productivo</th>
                <th className="px-5 py-3 font-medium">Leads (BBDD)</th>
                <th className="px-5 py-3 font-medium">Gestionados</th>
                <th className="px-5 py-3 font-medium">Conversiones</th>
                <th className="px-5 py-3 font-medium">% gestión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                    No hay campañas configuradas.
                  </td>
                </tr>
              )}
              {campaigns.map((c) => (
                <tr key={c.campaign_id}>
                  <td className="px-5 py-3 font-medium text-foreground">{c.campaign_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.workflow_name ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.total_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.managed_leads}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.conversions}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {c.managed_rate !== null ? `${c.managed_rate}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
