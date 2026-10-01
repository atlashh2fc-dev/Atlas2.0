import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeaderChip } from "./page-header-chip";

/**
 * Encabezado de página unificado: título + descripción + acciones a la derecha.
 * El chip de color del destino ya no se muestra por defecto (el menú dice dónde
 * estás); `chip` lo vuelve a poner donde haga falta.
 */
export function PageHeader({
  title,
  description,
  actions,
  chip = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  chip?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 pb-1",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {chip && <PageHeaderChip />}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
