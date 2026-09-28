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
        <span className="icon-chip mb-1 size-12 rounded-2xl" data-tone="slate" aria-hidden="true">
          <Icon size={22} />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
