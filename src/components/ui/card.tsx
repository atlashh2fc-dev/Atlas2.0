import type { ComponentType, CSSProperties, ReactNode } from "react";
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
    <div className={cn("rounded-xl border border-border bg-surface p-4 shadow-sm", className)}>{children}</div>
  );
}

/** Tono de acento de una sección; mismos nombres que los chips de icono. */
export type SectionTone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";

const TONE_VAR: Record<SectionTone, string> = {
  primary: "var(--primary)",
  blue: "var(--tone-blue)",
  teal: "var(--tone-teal)",
  green: "var(--tone-green)",
  amber: "var(--tone-amber)",
  violet: "var(--tone-violet)",
  rose: "var(--tone-rose)",
  slate: "var(--tone-slate)",
};

/**
 * Contenedor con cabecera para secciones densas (tablas, listas). No lleva
 * padding en el cuerpo para que la tabla llegue a los bordes. Con `icon` la
 * cabecera muestra el chip de color y, con `tone`, una línea de acento arriba
 * que identifica el canal o dominio de un vistazo (como Atlas Suite).
 */
export function SectionCard({
  title,
  description,
  actions,
  icon: Icon,
  tone,
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
  const accent = tone ? ({ "--section-accent": TONE_VAR[tone] } as CSSProperties) : undefined;
  return (
    <div
      className={cn("relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm", className)}
      style={accent}
    >
      {tone && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,var(--section-accent),transparent_85%)]"
        />
      )}
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-border bg-surface-muted/40 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="icon-chip mt-0.5 size-8 rounded-lg" data-tone={tone ?? "primary"} aria-hidden="true">
                <Icon size={16} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
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
