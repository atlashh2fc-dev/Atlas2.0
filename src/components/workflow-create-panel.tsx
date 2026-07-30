"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createWorkflow, createWorkflowFromTemplate } from "@/app/actions/workflows";
import { WORKFLOW_TEMPLATES } from "@/lib/workflow-templates";
import { Button, Field, Input, SlideOver, Select, SubmitButton, buttonClasses } from "@/components/ui";

/**
 * Crear flujo desde el panel lateral: desde cero o desde una plantilla. Antes
 * ocupaba media pantalla por encima de la lista de flujos
 * (docs/auditoria-vistas-workplace.md §2).
 */
export function WorkflowCreatePanel({
  campaigns,
  selectedCampaign,
  duplicateName = false,
}: {
  campaigns: { id: string; name: string; workflow_id: string | null }[];
  selectedCampaign?: { id: string; name: string } | null;
  duplicateName?: boolean;
}) {
  const [open, setOpen] = useState(duplicateName);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses()}>
        <Plus size={16} aria-hidden="true" />
        Nuevo flujo
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo flujo de gestión"
        description="Empieza desde cero o desde un guion ya armado; queda en borrador hasta que lo publiques."
        width="lg"
      >
        {duplicateName && (
          <p role="alert" className="mb-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            Ya existe un flujo con ese nombre.
          </p>
        )}

        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Primero crea una{" "}
            <Link href="/dashboard/admin/campanas" className="font-medium text-primary hover:underline">
              campaña
            </Link>{" "}
            para conectar el flujo.
          </p>
        ) : (
          <form action={createWorkflow} className="space-y-4">
            <Field label="Nombre">
              <Input name="name" required placeholder="Venta con validación de RUT" data-autofocus />
            </Field>

            <Field label="Descripción (opcional)">
              <Input name="description" placeholder="Guion para la base de julio" />
            </Field>

            {selectedCampaign ? (
              <>
                <input type="hidden" name="campaign_id" value={selectedCampaign.id} />
                <p className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  Se conectará a <span className="font-medium">{selectedCampaign.name}</span>.
                </p>
              </>
            ) : (
              <Field label="Campaña">
                <Select name="campaign_id" required defaultValue="">
                  <option value="" disabled>
                    Conectar a una campaña
                  </option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                      {campaign.workflow_id ? " (reemplaza su flujo actual)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <SubmitButton pendingLabel="Creando…">Crear y configurar</SubmitButton>
            </div>
          </form>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <p className="text-sm font-medium text-foreground">O parte de una plantilla</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Se crea con sus pasos ya armados y después la ajustas en el editor.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {WORKFLOW_TEMPLATES.map((template) => (
              <form
                key={template.id}
                action={createWorkflowFromTemplate}
                className="flex flex-col rounded-lg border border-border bg-background p-3"
              >
                <input type="hidden" name="template_id" value={template.id} />
                <span className="text-lg">{template.icon}</span>
                <span className="mt-1 text-sm font-medium text-foreground">{template.name}</span>
                <span className="mt-0.5 flex-1 text-xs text-muted-foreground">{template.description}</span>
                <span className="mt-1 text-[11px] text-muted-foreground">{template.steps.length} pasos</span>
                <SubmitButton variant="secondary" size="sm" className="mt-2" pendingLabel="Creando…">
                  Usar plantilla
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      </SlideOver>
    </>
  );
}
