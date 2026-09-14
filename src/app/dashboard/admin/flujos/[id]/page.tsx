import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { setWorkflowStatus } from "@/app/actions/workflows";
import { ActionForm, ActionSubmit, Badge, Callout, PageHeader } from "@/components/ui";

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

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("workflow_id", id)
    .eq("is_active", true)
    .order("name");
  const activeCampaigns = campaigns ?? [];

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
            <ActionForm
              action={setWorkflowStatus}
              success={workflow.status === "published" ? "Flujo devuelto a borrador" : "Flujo publicado"}
            >
              <input type="hidden" name="workflow_id" value={id} />
              <input type="hidden" name="status" value={workflow.status === "published" ? "draft" : "published"} />
              <ActionSubmit
                variant={workflow.status === "published" ? "secondary" : "primary"}
                size="sm"
                pendingLabel="Guardando…"
                title={
                  workflow.status === "published"
                    ? "Lo quita de la lista de flujos asignables a campañas. No detiene a las campañas que ya lo usan: siguen operando con cada cambio."
                    : "Lo valida y lo deja disponible para asignarlo a campañas."
                }
              >
                {workflow.status === "published" ? "Volver a borrador" : "Publicar"}
              </ActionSubmit>
            </ActionForm>
          </div>
        }
      />

      {/* La revisión del flujo vive bajo el lienzo, junto a la vista previa, y
          se recalcula con cada edición en vez de quedar fija desde la carga. */}
      <Callout tone={activeCampaigns.length > 0 ? "warning" : "info"}>
        <p className="font-medium text-foreground">Los cambios de este editor se aplican al instante.</p>
        <p className="mt-1 text-sm">
          {activeCampaigns.length > 0
            ? `Lo ${activeCampaigns.length === 1 ? "usa la campaña activa" : "usan las campañas activas"} ${activeCampaigns
                .map((campaign) => campaign.name)
                .join(", ")}: cada paso, opción o conexión que guardes cambia desde ya lo que el ejecutivo ve al tipificar.`
            : "Ninguna campaña activa lo usa todavía."}{" "}
          Revisa la vista previa bajo el lienzo antes de salir.
        </p>
      </Callout>

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
