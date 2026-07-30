"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createCampaign } from "@/app/actions/campaigns";
import { Button, Field, Input, SlideOver, SubmitButton, buttonClasses } from "@/components/ui";

/**
 * Crear campaña en panel lateral, no como formulario pegado al final de la
 * lista (docs/auditoria-vistas-workplace.md §2). La lista queda intacta detrás.
 */
export function CampaignCreatePanel({ duplicateName = false }: { duplicateName?: boolean }) {
  const [open, setOpen] = useState(duplicateName);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses()}>
        <Plus size={16} aria-hidden="true" />
        Nueva campaña
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva campaña"
        description="Después de crearla te llevamos a su configuración: flujo, ejecutivos, base y discado."
      >
        <form action={createCampaign} className="space-y-4">
          {duplicateName && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              Ya existe una campaña con ese nombre.
            </p>
          )}

          <Field label="Nombre">
            <Input name="name" required placeholder="Ventas Hogar Julio" data-autofocus />
          </Field>

          <Field label="Descripción (opcional)">
            <Input name="description" placeholder="Base Equifax, turno de tarde" />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton pendingLabel="Creando…">Crear y configurar</SubmitButton>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
