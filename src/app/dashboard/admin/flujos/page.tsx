import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toggleWorkflowActive } from "@/app/actions/workflows";
import Link from "next/link";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { WorkflowCreatePanel } from "@/components/workflow-create-panel";
import { ActionForm, ActionSubmit, Badge, Callout, PageHeader, SectionCard, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string; error?: string }>;
}) {
  await requireProfile(["admin"]);
  const { campaign_id: campaignId, error } = await searchParams;
  const supabase = await createClient();

  const { data: workflows, error: workflowsError } = await supabase
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
        <PageHeader
          title="Flujos de gestión"
          description="El guion que los ejecutivos siguen al gestionar un registro. Se publica solo cuando pasa la revisión."
          className="border-b-0 pb-0"
          actions={
            <WorkflowCreatePanel
              campaigns={campaigns ?? []}
              selectedCampaign={selectedCampaign ?? null}
              duplicateName={error === "duplicate-name"}
            />
          }
        />
      </div>

      {workflowsError && (
        <Callout tone="danger">No se pudieron cargar los flujos: {workflowsError.message}</Callout>
      )}

      <SectionCard>
        <Table>
          <Thead>
            <Th>Nombre</Th>
            <Th>En uso por</Th>
            <Th>Revisión</Th>
            <Th>Estado</Th>
            <Th />
          </Thead>
          <Tbody>
            {(workflows ?? []).length === 0 && (
              <TableEmpty colSpan={5}>
                Todavía no hay flujos. Crea el primero con el botón &ldquo;Nuevo flujo&rdquo;.
              </TableEmpty>
            )}
            {(workflows ?? []).map((w) => {
              const status = workflowStatus(issuesByWorkflow.get(w.id) ?? []);
              const usedBy = campaignsByWorkflow.get(w.id) ?? [];
              return (
                <Tr key={w.id}>
                  <Td strong>
                    <Link href={`/dashboard/admin/flujos/${w.id}`} className="hover:text-primary">
                      {w.name}
                    </Link>
                    {w.description && <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>}
                  </Td>
                  <Td muted>{usedBy.length > 0 ? usedBy.join(", ") : "Ninguna campaña"}</Td>
                  <Td>
                    <Link
                      href={`/dashboard/admin/flujos/${w.id}`}
                      className="inline-flex flex-wrap items-center gap-1.5"
                    >
                      <Badge tone={w.status === "published" ? "success" : "warning"}>
                        {w.status === "published" ? "Publicado" : "Borrador"}
                      </Badge>
                      <Badge
                        tone={
                          status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "success"
                        }
                      >
                        {status.label}
                      </Badge>
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={w.is_active ? "success" : "danger"}>{w.is_active ? "Activo" : "Inactivo"}</Badge>
                  </Td>
                  <Td align="right">
                    <ActionForm
                      action={toggleWorkflowActive}
                      success={w.is_active ? "Flujo desactivado" : "Flujo activado"}
                    >
                      <input type="hidden" name="workflow_id" value={w.id} />
                      <input type="hidden" name="active" value={String(w.is_active)} />
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="…">
                        {w.is_active ? "Desactivar" : "Activar"}
                      </ActionSubmit>
                    </ActionForm>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </SectionCard>

    </div>
  );
}
