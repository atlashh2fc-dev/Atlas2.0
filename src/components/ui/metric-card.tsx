import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";
import type { MetricId } from "@/lib/metric-definitions";
import { metricDefinition } from "@/lib/metric-definitions";

export type MetricTone = "default" | "good" | "warn" | "danger";

export type MetricDelta = {
  /** Variación respecto del período anterior, en la unidad que se muestre. */
  value: number;
  /** Texto del período comparado: "vs. semana anterior". */
  label: string;
  /** Cuando bajar es bueno (abandono, tiempo de espera). */
  invert?: boolean;
  /** Formato del número; por defecto se muestra con signo. */
  format?: (value: number) => string;
};

const TONE_TEXT: Record<MetricTone, string> = {
  default: "text-foreground",
  good: "text-success",
  warn: "text-warning",
  danger: "text-danger",
};

function DeltaBadge({ delta }: { delta: MetricDelta }) {
  const positive = delta.value > 0;
  const neutral = delta.value === 0;
  const good = delta.invert ? !positive : positive;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  const format = delta.format ?? ((value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString("es-CL")}`);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        neutral ? "text-muted-foreground" : good ? "text-success" : "text-danger"
      )}
      title={delta.label}
    >
      <Icon size={13} aria-hidden="true" />
      {format(delta.value)}
      <span className="font-normal text-muted-foreground">{delta.label}</span>
    </span>
  );
}

/**
 * Tarjeta de métrica del estándar: valor, comparación con el período anterior,
 * definición accesible y enlace al detalle que la compone (drill-down).
 * Toda métrica de un tablero debería poder abrirse: sin eso es un póster.
 */
export function MetricCard({
  label,
  value,
  hint,
  delta,
  href,
  hrefLabel = "Ver detalle",
  metric,
  tooltip,
  tone = "default",
  target,
  progress,
  className,
}: {
  label: ReactNode;
  value: string | number;
  hint?: ReactNode;
  delta?: MetricDelta;
  href?: string;
  hrefLabel?: string;
  /** Clave del glosario: aporta la definición y, si no hay `label`, el nombre. */
  metric?: MetricId;
  tooltip?: string;
  tone?: MetricTone;
  /** Meta a alcanzar, se muestra bajo el valor. */
  target?: string;
  progress?: number;
  className?: string;
}) {
  const definition = metric ? metricDefinition(metric) : null;
  const clamped = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const barClass =
    tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : tone === "danger" ? "bg-danger" : "bg-primary";

  const body = (
    <>
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label ?? definition?.label}
        {(tooltip || definition) && (
          <InfoTooltip text={tooltip ?? definition!.definition} formula={definition?.formula} />
        )}
      </p>

      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", TONE_TEXT[tone])}>{value}</p>

      {(delta || target) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta && <DeltaBadge delta={delta} />}
          {target && <span className="text-xs text-muted-foreground">Meta {target}</span>}
        </div>
      )}

      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}

      {clamped !== null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${clamped}%` }} />
        </div>
      )}

      {href && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
          {hrefLabel}
          <ArrowRight size={13} aria-hidden="true" />
        </span>
      )}
    </>
  );

  const base = "block rounded-lg border border-border bg-surface p-4 shadow-sm";

  if (!href) return <div className={cn(base, className)}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(base, "transition-colors hover:bg-surface-muted/50", className)}
    >
      {body}
    </Link>
  );
}
