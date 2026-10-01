import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Workflow } from "lucide-react";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { validateWorkflow, workflowStatus } from "@/lib/workflow-validation";
import { setWorkflowStatus } from "@/app/actions/workflows";
import { ActionForm, ActionSubmit, Badge, Callout, EmptyState } from "@/components/ui";
import { CabeceraDeEntidad, Migas } from "../../_diseno";

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
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
      <Migas
        items={[
          campaignId
            ? { label: "Volver a la campaña", href: `/dashboard/admin/campanas/${campaignId}` }
            : { label: "Flujos de gestión", href: "/dashboard/admin/flujos" },
          { label: workflow.name },
        ]}
      />

      <CabeceraDeEntidad
        nombre={workflow.name}
        icon={Workflow}
        apagada={!workflow.is_active}
        descripcion={workflow.description || "Sin descripción."}
        meta={
          <>
            <Badge tone={workflow.status === "published" ? "success" : "neutral"}>
              {workflow.status === "published" ? "Publicado" : "Borrador"}
            </Badge>
            <Badge tone={status.tone === "danger" ? "danger" : status.tone === "warning" ? "warning" : "success"}>
              {status.label}
            </Badge>
            <span>
              {(steps ?? []).length} {(steps ?? []).length === 1 ? "paso" : "pasos"}
            </span>
            <span>
              {activeCampaigns.length > 0
                ? `En uso por ${activeCampaigns.map((campaign) => campaign.name).join(", ")}`
                : "Ninguna campaña activa lo usa"}
            </span>
          </>
        }
        acciones={
          <ActionForm
            action={setWorkflowStatus}
            success={workflow.status === "published" ? "Flujo devuelto a borrador" : "Flujo publicado"}
          >
            <input type="hidden" name="workflow_id" value={id} />
            <input type="hidden" name="status" value={workflow.status === "published" ? "draft" : "published"} />
            <ActionSubmit
              variant={workflow.status === "published" ? "secondary" : "primary"}
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
        <div className="rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={Workflow}
            title="Este flujo todavía no tiene pasos."
            description="Usa el botón “+ Agregar paso” dentro del editor para empezar a construir el script de la campaña."
          />
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
