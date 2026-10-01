import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toggleWorkflowActive } from "@/app/actions/workflows";
import Link from "next/link";
import { Workflow } from "lucide-react";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { WorkflowCreatePanel } from "@/components/workflow-create-panel";
import { FlechaDeFila, Migas } from "../_diseno";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, PageHeader, SectionCard, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string; error?: string }>;
}) {
  const profile = await requireProfile(["admin", "supervisor"]);
  // Crear un flujo lo conecta a una campaña, y las campañas son del admin.
  const canCreate = profile.role === "admin";
  const { campaign_id: campaignId, error } = await searchParams;
  const supabase = await createClient();

  const { data: workflows, error: workflowsError } = await supabase
    .from("workflows")
    .select("*")
    .order("created_at", { ascending: true });
  if (workflowsError) console.error("[admin/flujos] carga de flujos", workflowsError);

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

  const list = workflows ?? [];
  const publishedCount = list.filter((workflow) => workflow.status === "published").length;
  const withIssues = list.filter((workflow) => workflowStatus(issuesByWorkflow.get(workflow.id) ?? []).tone !== "success").length;

  return (
    <div className="space-y-5">
      {selectedCampaign && (
        <Migas
          items={[
            { label: selectedCampaign.name, href: `/dashboard/admin/campanas/${selectedCampaign.id}` },
            { label: "Flujos de gestión" },
          ]}
        />
      )}
      <PageHeader
        title="Flujos de gestión"
        icon={Workflow}
        description="El guion que los ejecutivos siguen al gestionar un registro. Se publica solo cuando pasa la revisión."
        meta={
          list.length > 0 ? (
            <>
              <span>
                <span className="font-semibold text-foreground">{list.length}</span> {list.length === 1 ? "flujo" : "flujos"}
              </span>
              <span>
                <span className="font-semibold text-foreground">{publishedCount}</span> {publishedCount === 1 ? "publicado" : "publicados"}
              </span>
              {withIssues > 0 && (
                <span className="text-warning">
                  <span className="font-semibold">{withIssues}</span> por revisar
                </span>
              )}
            </>
          ) : undefined
        }
        actions={
          canCreate ? (
            <WorkflowCreatePanel
              campaigns={campaigns ?? []}
              selectedCampaign={selectedCampaign ?? null}
              duplicateName={error === "duplicate-name"}
            />
          ) : null
        }
      />

      {workflowsError && (
        <Callout tone="danger">
          No se pudieron cargar los flujos. Actualiza la página en unos segundos; si sigue igual, avisa a soporte.
        </Callout>
      )}

      <SectionCard>
        <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Th>Flujo</Th>
            <Th>Revisión</Th>
            <Th>Publicación</Th>
            <Th>Estado</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </Thead>
          <Tbody>
            {list.length === 0 && (
              <TableEmpty colSpan={5}>
                <EmptyState
                  icon={Workflow}
                  title="Todavía no hay flujos"
                  description={canCreate ? "Crea el primero con el botón “Nuevo flujo”, desde cero o desde una plantilla." : "Un administrador crea el flujo al configurar la campaña; desde aquí lo editas."}
                  className="py-6"
                />
              </TableEmpty>
            )}
            {list.map((w) => {
              const status = workflowStatus(issuesByWorkflow.get(w.id) ?? []);
              const usedBy = campaignsByWorkflow.get(w.id) ?? [];
              const href = `/dashboard/admin/flujos/${w.id}`;
              return (
                <Tr key={w.id}>
                  <Td className="min-w-72">
                    <div className="flex items-center gap-3">
                      <Avatar name={w.name} icon={Workflow} size="md" shape="square" className={w.is_active ? "" : "opacity-50"} />
                      <div className="min-w-0">
                        <Link href={href} className="font-medium text-foreground hover:text-primary">
                          {w.name}
                        </Link>
                        <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground" title={usedBy.join(", ") || undefined}>
                          {usedBy.length > 0 ? `En uso por ${usedBy.join(", ")}` : "Ninguna campaña lo usa"}
                          {w.description ? ` · ${w.description}` : ""}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "success"}>
                      {status.label}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={w.status === "published" ? "success" : "neutral"}>
                      {w.status === "published" ? "Publicado" : "Borrador"}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={w.is_active ? "success" : "neutral"}>{w.is_active ? "Activo" : "Inactivo"}</Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                    <ActionForm
                      action={toggleWorkflowActive}
                      success={w.is_active ? "Flujo desactivado" : "Flujo activado"}
                      confirm={
                        w.is_active
                          ? {
                              title: `¿Desactivar el flujo «${w.name}»?`,
                              // Desactivar no lo desasigna: la tipificación lee
                              // campaigns.workflow_id sin mirar is_active. Mejor
                              // decirlo que prometer un efecto que no ocurre.
                              description:
                                usedBy.length > 0
                                  ? `Lo usan ${usedBy.join(", ")}. Esas campañas siguen mostrando este guion a sus ejecutivos hasta que les asignes otro flujo desde su Resumen.`
                                  : "Ninguna campaña lo usa hoy. Puedes volver a activarlo cuando quieras.",
                              confirmLabel: "Desactivar flujo",
                              tone: "danger",
                            }
                          : undefined
                      }
                    >
                      <input type="hidden" name="workflow_id" value={w.id} />
                      <input type="hidden" name="active" value={String(w.is_active)} />
                      <ActionSubmit variant="ghost" size="sm" pendingLabel="…">
                        {w.is_active ? "Desactivar" : "Activar"}
                      </ActionSubmit>
                    </ActionForm>
                    <FlechaDeFila href={href} label={`Editar ${w.name}`} />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        </div>
      </SectionCard>
    </div>
  );
}
