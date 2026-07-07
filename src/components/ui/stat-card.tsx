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
    <div className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {clampedProgress !== null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${clampedProgress}%` }} />
        </div>
      )}
    </div>
  );
}
