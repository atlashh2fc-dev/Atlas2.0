import type { ComponentType, ReactNode } from "react";
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
    <div className={cn("rounded-xl border border-border bg-surface p-5 shadow-sm", className)}>{children}</div>
  );
}

/** Tono de acento de una sección; mismos nombres que los chips de icono. */
export type SectionTone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";


/**
 * Contenedor con cabecera para secciones densas (tablas, listas). No lleva
 * padding en el cuerpo para que la tabla llegue a los bordes.
 *
 * `icon` y `tone` se aceptan por compatibilidad, pero ya no pintan chip de
 * color ni línea de acento: con una sección por pantalla eran decoración, con
 * seis eran un arcoíris. La sección la identifica su título.
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
  icon?: ComponentType<{ size?: number }>;
  tone?: SectionTone;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = title || description || actions;
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-sm", className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
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
