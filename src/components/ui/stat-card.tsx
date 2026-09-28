import { cn } from "@/lib/utils";
import { MetricIconChip, type IconTone } from "./metric-card";
import type { ComponentProps } from "react";

export function StatCard({
  label,
  value,
  hint,
  progress,
  tone = "default",
  icon,
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
    <div className={cn("rounded-xl border border-border bg-surface p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon && <MetricIconChip icon={icon} tone={iconTone} />}
      </div>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
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
