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
      {Icon && <Icon size={28} className="text-muted-foreground/50" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
