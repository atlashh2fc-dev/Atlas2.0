import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Estado vacío unificado: icono opcional + título + descripción + acción. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ size?: number; className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-5 py-12 text-center", className)}>
      {Icon && (
        <span
          className="mb-2 flex size-12 items-center justify-center rounded-2xl border border-border bg-surface-raised text-muted-foreground shadow-sm"
          style={{ backgroundImage: "linear-gradient(140deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent 70%)" }}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
