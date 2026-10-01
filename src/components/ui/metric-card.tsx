import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./info-tooltip";
import type { MetricId } from "@/lib/metric-definitions";
import { metricDefinition } from "@/lib/metric-definitions";

export type MetricTone = "default" | "good" | "warn" | "danger";

/** Tono del chip de icono (ver `.icon-chip` en globals.css). */
export type IconTone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";

type MetricIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;

function InlineIcon({ icon: Icon }: { icon: MetricIcon }) {
  return <Icon size={14} aria-hidden="true" />;
}

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
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={delta.label}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
          neutral ? "bg-surface-muted text-muted-foreground" : good ? "bg-success/12 text-success" : "bg-danger/12 text-danger"
        )}
      >
        <Icon size={11} aria-hidden="true" />
        {format(delta.value)}
      </span>
      {delta.label}
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
  /** Icono de lucide junto a la etiqueta. */
  icon?: MetricIcon;
  /** Se acepta por compatibilidad; el ícono ya no lleva chip de color. */
  iconTone?: IconTone;
  className?: string;
}) {
  const definition = metric ? metricDefinition(metric) : null;
  const clamped = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const barClass =
    tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : tone === "danger" ? "bg-danger" : "bg-primary";

  const body = (
    <>
      {/* El ícono acompaña la etiqueta, en gris: un chip de color por tarjeta
          volvía el tablero un muestrario. El color queda para el estado. */}
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon && <InlineIcon icon={icon} />}
          {label ?? definition?.label}
          {(tooltip || definition) && (
            <InfoTooltip text={tooltip ?? definition!.definition} formula={definition?.formula} />
          )}
        </p>
        {href && <ArrowUpRight size={14} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />}
      </div>

      <p className={cn("mt-3 text-[28px] font-semibold leading-none tabular-nums tracking-tight", TONE_TEXT[tone])}>{value}</p>

      {(delta || target) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
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

      {href && <span className="sr-only">{hrefLabel}</span>}
    </>
  );

  const base = "atlas-panel group block rounded-xl border border-border bg-surface p-5 shadow-sm";

  if (!href) return <div className={cn(base, className)}>{body}</div>;

  return (
    <Link
      href={href}
      className={cn(base, "transition-[border-color,box-shadow,background-color] hover:border-border-strong hover:bg-surface-muted/40 hover:shadow-md", className)}
    >
      {body}
    </Link>
  );
}
