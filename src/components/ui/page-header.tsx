import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeaderChip } from "./page-header-chip";

/**
 * Encabezado de página unificado: título + descripción + acciones a la derecha.
 * El chip de color del destino ya no se muestra por defecto (el menú dice dónde
 * estás); `chip` lo vuelve a poner donde haga falta.
 *
 * `icon` pone la baldosa del destino junto al título y `meta` una línea corta
 * de contexto (cuántos registros, última lectura): es lo que hace que una
 * página se lea como un objeto del producto y no como un título sobre una tabla.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  meta,
  chip = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true"; strokeWidth?: number }>;
  meta?: ReactNode;
  chip?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 pb-1", className)}>
      <div className="flex min-w-0 items-start gap-3.5">
        {chip && <PageHeaderChip />}
        {Icon && (
          <span
            className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-primary shadow-sm"
            style={{ backgroundImage: "linear-gradient(140deg, color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%)" }}
            aria-hidden="true"
          >
            <Icon size={20} aria-hidden="true" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
        </div>
      </div>
      {actions}
    </div>
  );
}
