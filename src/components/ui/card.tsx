import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Tarjeta de contenido estándar (contenedor con padding). */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4 shadow-sm", className)}>{children}</div>
  );
}

/**
 * Contenedor con cabecera para secciones densas (tablas, listas). No lleva
 * padding en el cuerpo para que la tabla llegue a los bordes.
 */
export function SectionCard({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = title || description || actions;
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface shadow-sm", className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

type CalloutTone = "info" | "success" | "warning" | "danger";

const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: "border-border bg-surface-muted text-foreground",
  success: "border-success/30 bg-success-bg text-success",
  warning: "border-warning/30 bg-warning-bg text-warning",
  danger: "border-danger/30 bg-danger-bg text-danger",
};

/** Bloque de mensaje contextual (errores de configuración, avisos, etc.). */
export function Callout({
  tone = "info",
  className,
  children,
}: {
  tone?: CalloutTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-4 text-sm", CALLOUT_TONES[tone], className)}>{children}</div>
  );
}
