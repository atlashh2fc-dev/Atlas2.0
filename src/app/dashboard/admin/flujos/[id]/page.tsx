import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile(["admin"]);
  const { id } = await params;
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{workflow.name}</h1>
        <p className="text-sm text-muted-foreground">
          {workflow.description || "Sin descripción."}
        </p>
      </div>

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
