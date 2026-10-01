import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, InfoTooltip } from "@/components/ui";

/*
 * Sin "use client": la vista del supervisor es de servidor y le pasa iconos a
 * estas piezas; las del admin las usan desde un componente de cliente.
 *
 * Piezas de los tableros de Reportes, compartidas por la vista de admin y la
 * de supervisor (son ramas aparte y lo que se agrega a una se perdía en la
 * otra). Todo pinta con variables del tema: cambia solo en claro y oscuro.
 */

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-CL");

/* ------------------------------------------------------------------------ */
/* Tooltip de gráficos                                                       */
/* ------------------------------------------------------------------------ */

type TooltipEntry = {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

/**
 * Tooltip de recharts como tarjeta: la fecha arriba y cada serie con su punto
 * de color, nombre y cifra alineada. Reemplaza la caja por defecto, que
 * mostraba "gestiones : 1234" en el color de la serie y sin formato.
 * Uso: `<Tooltip content={<ChartTooltip />} />`.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  formatLabel,
  names,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Formato por serie; por defecto número entero con separador de miles. */
  formatValue?: (value: number, dataKey: string) => string;
  formatLabel?: (label: string | number | undefined, payload: TooltipEntry[]) => ReactNode;
  /** Nombre legible por `dataKey`. */
  names?: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = formatLabel ? formatLabel(label, payload) : label;
  return (
    <div className="min-w-44 rounded-xl border border-border-strong bg-surface-solid px-3 py-2.5 text-xs shadow-xl">
      {heading !== undefined && heading !== "" && (
        <p className="mb-2 font-semibold text-foreground">{heading}</p>
      )}
      <ul className="space-y-1.5">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? entry.name ?? "");
          const raw = Array.isArray(entry.value) ? entry.value[0] : entry.value;
          const numeric = typeof raw === "number" ? raw : Number(raw);
          const color = entry.color && !entry.color.startsWith("url(") ? entry.color : entry.stroke ?? "var(--primary)";
          return (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="text-muted-foreground">{names?.[key] ?? entry.name}</span>
              <span className="ml-auto pl-4 font-semibold tabular-nums text-foreground">
                {raw === null || raw === undefined || Number.isNaN(numeric)
                  ? "—"
                  : formatValue
                    ? formatValue(numeric, key)
                    : fmtInt(numeric)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Leyenda con totales                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Leyenda en la cabecera del gráfico, con el total de cada serie: el lector
 * sabe cuánto suma antes de recorrer la curva.
 */
export function ChartLegend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs">
          <span aria-hidden="true" className="h-2 w-3 shrink-0 rounded-full" style={{ background: item.color }} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value && <span className="font-semibold tabular-nums text-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------ */
/* Mini curva de tendencia                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Curva de tendencia sin ejes, en SVG puro (no monta recharts por cada KPI).
 * Con menos de dos puntos no dibuja nada: una línea plana mentiría.
 */
export function Sparkline({
  values,
  color = "var(--primary)",
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  // Id estable sin hooks (sirve también en componentes de servidor).
  let hash = 0;
  for (const char of `${color}|${values.join(",")}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const id = `spark-${Math.abs(hash).toString(36)}`;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const width = 100;
  const height = 32;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.25} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Variación contra el período anterior                                      */
/* ------------------------------------------------------------------------ */

/**
 * Variación porcentual en una caja suave verde o roja. `invert` cuando bajar
 * es bueno (vencidas, abandono). Sin base comparable dice "sin comparación".
 */
export function DeltaChip({ change, invert = false, suffix }: { change: number | null; invert?: boolean; suffix?: string }) {
  if (change === null || !Number.isFinite(change)) {
    return <span className="text-[11px] text-muted-foreground">Sin comparación</span>;
  }
  const flat = Math.abs(change) < 0.0005;
  const good = invert ? change < 0 : change > 0;
  const Arrow = flat ? Minus : change > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
          flat
            ? "bg-surface-muted text-muted-foreground"
            : good
              ? "bg-success/12 text-success"
              : "bg-danger/12 text-danger"
        )}
      >
        <Arrow size={11} aria-hidden="true" />
        {(Math.abs(change) * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 })}%
      </span>
      {suffix ?? "vs. período anterior"}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Franja de KPIs                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Indicadores en una sola tarjeta dividida, como los tableros de Stripe o
 * Vercel: se leen como un resumen, no como diez cajas sueltas compitiendo.
 */
export function KpiStrip({
  title,
  meta,
  columns = 5,
  children,
  className,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  /** Columnas en pantallas anchas. */
  columns?: 3 | 4 | 5;
  children: ReactNode;
  className?: string;
}) {
  const grid = columns === 5 ? "lg:grid-cols-5" : columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <section className={cn("atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm", className)}>
      {(title || meta) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </header>
      )}
      <div className={cn("grid grid-cols-1 gap-px bg-border sm:grid-cols-2", grid)}>{children}</div>
    </section>
  );
}

export type KpiTone = "default" | "good" | "warn" | "danger";

const KPI_VALUE: Record<KpiTone, string> = {
  default: "text-foreground",
  good: "text-success",
  warn: "text-warning",
  danger: "text-danger",
};

const KPI_BAR: Record<KpiTone, string> = {
  default: "var(--primary)",
  good: "var(--success)",
  warn: "var(--warning)",
  danger: "var(--danger)",
};

/**
 * Un indicador de la franja: etiqueta con su icono, cifra grande, variación
 * y abajo la tendencia (curva) o la proporción (barra). Si lleva `href`, toda
 * la celda abre el detalle que la compone.
 */
export function KpiStripItem({
  label,
  value,
  icon: IconComponent,
  tone = "default",
  definition,
  delta,
  detail,
  trend,
  trendColor,
  progress,
  href,
}: {
  label: ReactNode;
  value: string;
  icon?: Icon;
  tone?: KpiTone;
  /** Definición del glosario para el ícono de ayuda. */
  definition?: { text: string; formula?: string };
  delta?: ReactNode;
  detail?: ReactNode;
  trend?: number[];
  trendColor?: string;
  /** 0–100: proporción que representa la cifra (asignados de la base, etc.). */
  progress?: number;
  href?: string;
}) {
  const clamped = typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {IconComponent && <IconComponent size={14} className="shrink-0" aria-hidden="true" />}
          <span className="truncate">{label}</span>
          {definition && <InfoTooltip text={definition.text} formula={definition.formula} />}
        </p>
        {href && (
          <ArrowUpRight
            size={14}
            className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
        )}
      </div>
      <p className={cn("mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums", KPI_VALUE[tone])}>{value}</p>
      {(delta || detail) && (
        <div className="mt-2 space-y-1">
          {delta && <div>{delta}</div>}
          {detail && <p className="truncate text-[11px] text-muted-foreground">{detail}</p>}
        </div>
      )}
      <div className="mt-auto pt-3">
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} color={trendColor ?? KPI_BAR[tone]} />
        ) : clamped !== null ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: KPI_BAR[tone] }} />
          </div>
        ) : null}
      </div>
    </>
  );

  const base = "group flex min-h-[9.5rem] flex-col bg-surface px-5 py-4";
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(base, "transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
    >
      {body}
    </Link>
  );
}

/* ------------------------------------------------------------------------ */
/* Ranking                                                                   */
/* ------------------------------------------------------------------------ */

export type LeaderboardRow = {
  id: string;
  name: string;
  /** Línea secundaria: equipo, campaña. */
  caption?: string | null;
  /** Métrica que ordena y dibuja la barra. */
  primary: number;
  /** Columnas a la derecha, ya formateadas. */
  stats: { label: string; value: string; strong?: boolean; tone?: "good" }[];
};

const MEDAL = ["#f5b941", "#a8b3c4", "#d08a4f"] as const;

/**
 * Ranking de ejecutivos: posición (podio para los tres primeros), avatar,
 * barra con la métrica principal contra el líder y las cifras al lado.
 */
export function Leaderboard({
  rows,
  primaryLabel,
  empty = "Sin datos en el período.",
}: {
  rows: LeaderboardRow[];
  primaryLabel: string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  const leader = Math.max(1, ...rows.map((row) => row.primary));
  return (
    <ol className="divide-y divide-border/70">
      {rows.map((row, index) => {
        const medal = index < 3 && row.primary > 0 ? MEDAL[index] : null;
        return (
          <li key={row.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                medal ? "text-[#1a1306]" : "text-muted-foreground"
              )}
              style={medal ? { background: medal } : undefined}
              aria-label={`Posición ${index + 1}`}
            >
              {index + 1}
            </span>
            <Avatar name={row.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground" title={row.name}>{row.name}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(row.primary / leader) * 100}%`,
                    background: "linear-gradient(90deg, color-mix(in srgb, var(--primary) 55%, transparent), var(--primary))",
                  }}
                />
              </div>
              {row.caption && <p className="mt-1 truncate text-[11px] text-muted-foreground">{row.caption}</p>}
            </div>
            <dl className="flex shrink-0 gap-3">
              <div className="w-14 text-right">
                <dt className="truncate text-[10px] text-muted-foreground">{primaryLabel}</dt>
                <dd className="text-[13px] font-semibold tabular-nums text-foreground">{fmtInt(row.primary)}</dd>
              </div>
              {row.stats.map((stat) => (
                <div key={stat.label} className="hidden w-12 text-right md:block">
                  <dt className="truncate text-[10px] text-muted-foreground">{stat.label}</dt>
                  <dd
                    className={cn(
                      "text-[13px] tabular-nums",
                      stat.tone === "good" ? "font-semibold text-success" : stat.strong ? "font-semibold text-foreground" : "text-foreground"
                    )}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
