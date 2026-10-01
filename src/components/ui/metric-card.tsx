import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";
import type { MetricId } from "@/lib/metric-definitions";
import { metricDefinition } from "@/lib/metric-definitions";

export type MetricTone = "default" | "good" | "warn" | "danger";

/** Tono del chip de icono (ver `.icon-chip` en globals.css). */
export type IconTone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";

type MetricIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;

/** Con tono de alerta el chip toma el color del estado; si no, el propio. */
const TONE_CHIP: Partial<Record<MetricTone, IconTone>> = { warn: "amber", danger: "rose" };

/** Chip de icono de las tarjetas de métrica, arriba a la derecha. */
export function MetricIconChip({ icon: Icon, tone }: { icon: MetricIcon; tone: IconTone }) {
  return (
    <span className="icon-chip size-7 rounded-md" data-tone={tone} aria-hidden="true">
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}

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
  icon,
  iconTone = "primary",
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
  /** Icono de lucide para el chip de la esquina. */
  icon?: MetricIcon;
  iconTone?: IconTone;
  className?: string;
}) {
  const definition = metric ? metricDefinition(metric) : null;
  const clamped = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const barClass =
    tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : tone === "danger" ? "bg-danger" : "bg-primary";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground">
          {label ?? definition?.label}
          {(tooltip || definition) && (
            <InfoTooltip text={tooltip ?? definition!.definition} formula={definition?.formula} />
          )}
        </p>
        {icon && <MetricIconChip icon={icon} tone={TONE_CHIP[tone] ?? iconTone} />}
      </div>

      <p className={cn("mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight", TONE_TEXT[tone])}>{value}</p>

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

  const base = "block rounded-xl border border-border bg-surface p-5 shadow-sm";

  if (!href) return <div className={cn(base, className)}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(base, "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md", className)}
    >
      {body}
    </Link>
  );
}
