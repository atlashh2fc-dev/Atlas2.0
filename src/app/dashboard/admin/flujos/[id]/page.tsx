import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { setWorkflowStatus } from "@/app/actions/workflows";
import { Badge, Button, PageHeader, SectionCard } from "@/components/ui";

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const { campaign_id: campaignId } = await searchParams;
  const supabase = await createClient();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", id)
    .single();

  if (!workflow) notFound();

  const { data: steps } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", id)
    .order("step_order", { ascending: true });

  const { data: branches } = await supabase
    .from("workflow_step_branches")
    .select("*")
    .eq("workflow_id", id);

  const issues = validateWorkflow((steps ?? []) as WorkflowStep[], (branches ?? []) as WorkflowStepBranch[]);
  const status = workflowStatus(issues);

  return (
    <div className="space-y-4">
      {campaignId && (
        <Link
          href={`/dashboard/admin/campanas/${campaignId}`}
          className="inline-block text-xs text-muted-foreground hover:text-primary"
        >
          ← Volver a la campaña y continuar su configuración
        </Link>
      )}

      <PageHeader
        title={workflow.name}
        description={workflow.description || "Sin descripción."}
        className="border-b-0 pb-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={workflow.status === "published" ? "success" : "warning"}>
              {workflow.status === "published" ? "Publicado" : "Borrador"}
            </Badge>
            <Badge tone={status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "success"}>
              {status.label}
            </Badge>
            <form action={setWorkflowStatus}>
              <input type="hidden" name="workflow_id" value={id} />
              <input type="hidden" name="status" value={workflow.status === "published" ? "draft" : "published"} />
              <Button
                type="submit"
                variant={workflow.status === "published" ? "secondary" : "primary"}
                size="sm"
                title={
                  workflow.status === "published"
                    ? "Volver a borrador para editarlo sin afectar la operación"
                    : "Publicar el flujo para que las campañas lo usen"
                }
              >
                {workflow.status === "published" ? "Volver a borrador" : "Publicar"}
              </Button>
            </form>
          </div>
        }
      />

      {issues.length > 0 && (
        <SectionCard
          title="Revisión del flujo"
          description="Corrige esto antes de dejar el flujo operando: son los caminos por donde un ejecutivo puede quedarse sin salida."
        >
          <ul className="space-y-2 p-4 text-sm">
            {issues.map((issue, index) => (
              <li key={index} className="flex items-start gap-2">
                {issue.level === "error" ? (
                  <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-danger" aria-hidden="true" />
                ) : (
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-warning" aria-hidden="true" />
                )}
                <span className={issue.level === "error" ? "text-foreground" : "text-muted-foreground"}>
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {(steps ?? []).length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">
          Este flujo todavía no tiene pasos. Usa el botón &quot;+ Agregar paso&quot; dentro del editor para
          empezar a construir el script de la campaña.
        </div>
      ) : null}

      <WorkflowCanvas
        workflowId={id}
        initialSteps={(steps ?? []) as WorkflowStep[]}
        initialBranches={(branches ?? []) as WorkflowStepBranch[]}
      />
    </div>
  );
}
