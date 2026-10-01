import { cn } from "@/lib/utils";
import { type IconTone, type MetricIconChip } from "./metric-card";
import type { ComponentProps } from "react";

export function StatCard({
  label,
  value,
  hint,
  progress,
  tone = "default",
  icon: Icon,
  iconTone = "primary",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  progress?: number;
  tone?: "default" | "good" | "warn" | "danger";
  icon?: ComponentProps<typeof MetricIconChip>["icon"];
  iconTone?: IconTone;
  className?: string;
}) {
  const clampedProgress =
    typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const barClass =
    tone === "good"
      ? "bg-success"
      : tone === "warn"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-danger"
          : "bg-primary";

  return (
    <div className={cn("atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm", className)} data-tone={iconTone}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon size={14} aria-hidden="true" />}
        {label}
      </p>
      <p
        className={cn(
          "mt-3 text-[28px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {clampedProgress !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${clampedProgress}%` }} />
        </div>
      )}
    </div>
  );
}
