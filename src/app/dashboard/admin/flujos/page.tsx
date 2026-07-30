import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createWorkflow, createWorkflowFromTemplate, toggleWorkflowActive } from "@/app/actions/workflows";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";
import Link from "next/link";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { Badge } from "@/components/ui";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string; error?: string }>;
}) {
  await requireProfile(["admin"]);
  const { campaign_id: campaignId, error } = await searchParams;
  const supabase = await createClient();

  const { data: workflows } = await supabase
    .from("workflows")
    .select("*")
    .order("created_at", { ascending: true });

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, workflow_id")
    .order("name");

  // Revisión de todos los flujos de una vez: dos tablas chicas, un viaje.
  const [{ data: allSteps }, { data: allBranches }] = await Promise.all([
    supabase.from("workflow_steps").select("*"),
    supabase.from("workflow_step_branches").select("*"),
  ]);

  const issuesByWorkflow = new Map<string, ReturnType<typeof validateWorkflow>>();
  for (const workflow of workflows ?? []) {
    issuesByWorkflow.set(
      workflow.id,
      validateWorkflow(
        ((allSteps ?? []) as WorkflowStep[]).filter((step) => step.workflow_id === workflow.id),
        ((allBranches ?? []) as WorkflowStepBranch[]).filter((branch) => branch.workflow_id === workflow.id)
      )
    );
  }

  const campaignsByWorkflow = new Map<string, string[]>();
  for (const campaign of campaigns ?? []) {
    if (!campaign.workflow_id) continue;
    campaignsByWorkflow.set(campaign.workflow_id, [
      ...(campaignsByWorkflow.get(campaign.workflow_id) ?? []),
      campaign.name,
    ]);
  }

  const selectedCampaign = (campaigns ?? []).find((campaign) => campaign.id === campaignId);

  return (
    <div className="space-y-6">
      <div>
        {selectedCampaign && (
          <Link
            href={`/dashboard/admin/campanas/${selectedCampaign.id}`}
            className="mb-2 inline-block text-xs text-muted-foreground hover:text-primary"
          >
            ← Volver a {selectedCampaign.name}
          </Link>
        )}
        <h1 className="text-xl font-semibold text-foreground">Flujos de gestión</h1>
        <p className="text-sm text-muted-foreground">
          Define los pasos obligatorios que los agentes deben completar al gestionar un lead.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Plantillas de campañas frecuentes</h2>
        {error === "duplicate-name" && (
          <p role="alert" className="mt-2 text-sm text-danger">
            Ya existe un flujo con ese nombre.
          </p>
        )}
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Empieza desde cero o desde un script ya armado y ajústalo en el editor visual.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col rounded-xl border border-primary/35 bg-primary/5 p-4">
            <span className="text-2xl">✦</span>
            <h3 className="mt-2 text-sm font-semibold text-foreground">Crear flujo desde cero</h3>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">
              {selectedCampaign
                ? `Diseña los pasos para ${selectedCampaign.name}; quedará conectado automáticamente.`
                : "Diseña tus propios pasos y déjalo conectado inmediatamente a una campaña."}
            </p>
            {(campaigns ?? []).length > 0 ? (
              <form action={createWorkflow} className="mt-3 space-y-2">
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Nombre del flujo"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
                />
                <input
                  type="text"
                  name="description"
                  placeholder="Descripción (opcional)"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
                />
                {selectedCampaign ? (
                  <>
                    <input type="hidden" name="campaign_id" value={selectedCampaign.id} />
                    <p className="rounded-lg border border-primary/25 bg-background px-3 py-2 text-xs font-medium text-foreground">
                      Campaña: {selectedCampaign.name}
                    </p>
                  </>
                ) : (
                  <select
                    name="campaign_id"
                    required
                    defaultValue=""
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    <option value="" disabled>
                      Conectar a una campaña
                    </option>
                    {(campaigns ?? []).map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}{campaign.workflow_id ? " (reemplaza su flujo actual)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="submit"
                  className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Crear y configurar flujo
                </button>
              </form>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Primero crea una{" "}
                <Link href="/dashboard/admin/campanas" className="text-primary hover:underline">
                  campaña
                </Link>{" "}
                para conectar este flujo.
              </p>
            )}
          </div>
          {WORKFLOW_TEMPLATES.map((t) => (
            <div key={t.id} className="flex flex-col rounded-xl border border-border bg-background p-4">
              <span className="text-2xl">{t.icon}</span>
              <h3 className="mt-2 text-sm font-semibold text-foreground">{t.name}</h3>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{t.description}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{t.steps.length} pasos</p>
              <form action={createWorkflowFromTemplate} className="mt-3">
                <input type="hidden" name="template_id" value={t.id} />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Usar esta plantilla
                </button>
              </form>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">En uso por</th>
              <th className="px-5 py-3 font-medium">Revisión</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(workflows ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Todavía no hay flujos creados.
                </td>
              </tr>
            )}
            {(workflows ?? []).map((w) => {
              const status = workflowStatus(issuesByWorkflow.get(w.id) ?? []);
              const usedBy = campaignsByWorkflow.get(w.id) ?? [];
              return (
              <tr key={w.id}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <Link href={`/dashboard/admin/flujos/${w.id}`} className="hover:text-primary">
                    {w.name}
                  </Link>
                  {w.description && <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>}
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">
                  {usedBy.length > 0 ? usedBy.join(", ") : "Ninguna campaña"}
                </td>
                <td className="px-5 py-3">
                  <Link href={`/dashboard/admin/flujos/${w.id}`} className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone={w.status === "published" ? "success" : "warning"}>
                      {w.status === "published" ? "Publicado" : "Borrador"}
                    </Badge>
                    <Badge tone={status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "success"}>
                      {status.label}
                    </Badge>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      w.is_active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                    }`}
                  >
                    {w.is_active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <form action={toggleWorkflowActive}>
                    <input type="hidden" name="workflow_id" value={w.id} />
                    <input type="hidden" name="active" value={String(w.is_active)} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      {w.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
