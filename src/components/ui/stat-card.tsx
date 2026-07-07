import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  progress,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  progress?: number;
  tone?: "default" | "good" | "warn" | "danger";
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
    <div className={cn("rounded-lg border border-border bg-surface p-4 shadow-sm", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {clampedProgress !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${clampedProgress}%` }} />
        </div>
      )}
    </div>
  );
}
