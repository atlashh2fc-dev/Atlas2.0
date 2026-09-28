import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeaderChip } from "./page-header-chip";

/**
 * Encabezado de página unificado: chip del destino + título + descripción +
 * acciones a la derecha. El chip sale solo del menú; `chip={false}` lo quita.
 */
export function PageHeader({
  title,
  description,
  actions,
  chip = true,
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
        "flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {chip && <PageHeaderChip />}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
