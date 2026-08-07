"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Panel lateral para crear y editar sin salir de la lista.
 *
 * Reemplaza el patrón de "formulario incrustado al final de la tabla": la lista
 * queda intacta detrás, con sus filtros y su página
 * (docs/auditoria-vistas-workplace.md §2).
 */
export function SlideOver({
  open,
  onClose,
  title,
  description,
  footer,
  width = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // `onClose` suele llegar como función inline, así que cambia de identidad en
  // cada render del padre. Si el efecto dependiera de ella, se reejecutaría
  // constantemente y devolvería el foco al panel mientras el usuario escribe:
  // en el CTI, que re-renderiza cada segundo, eso obligaba a volver a pinchar
  // el campo después de cada dígito.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // El botón de cerrar precede a los campos en el DOM, así que un selector
    // combinado se lo llevaba siempre: `data-autofocus` se busca aparte para
    // que el formulario reciba el foco de entrada.
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>("input, select, textarea, button");
    target?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const widthClass = width === "sm" ? "max-w-md" : width === "lg" ? "max-w-3xl" : "max-w-xl";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("relative flex h-full w-full flex-col border-l border-border bg-surface shadow-xl", widthClass)}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
