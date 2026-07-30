"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button, SlideOver, buttonClasses } from "@/components/ui";

/**
 * Botón primario + panel lateral para los formularios de creación simples.
 *
 * Evita el patrón que la auditoría marcó como el más "interno" del producto:
 * el formulario de creación pegado al final de la lista
 * (docs/auditoria-vistas-workplace.md §2).
 */
export function CreatePanel({
  label,
  title,
  description,
  action,
  submitLabel = "Crear",
  children,
}: {
  /** Texto del botón que abre el panel. */
  label: string;
  title: string;
  description?: string;
  /** Server action que recibe el FormData del panel. */
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses()}>
        <Plus size={16} aria-hidden="true" />
        {label}
      </button>

      <SlideOver open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={action} className="space-y-4">
          {children}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
