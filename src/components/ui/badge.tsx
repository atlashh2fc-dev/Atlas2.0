import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted-foreground",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-surface-muted text-primary",
};

/** Pill semántico para estados, prioridades y etiquetas. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Punto de estado (registro SIP, disponibilidad de agente, salud de cola). */
export function StatusDot({ tone = "neutral", className }: { tone?: BadgeTone; className?: string }) {
  const color =
    tone === "success"
      ? "bg-success"
      : tone === "warning"
        ? "bg-warning"
        : tone === "danger"
          ? "bg-danger"
          : tone === "info"
            ? "bg-primary"
            : "bg-muted-foreground";
  return <span className={cn("inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full", color, className)} />;
}
