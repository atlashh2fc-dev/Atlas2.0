import { formatPercent, formatScore } from "@/components/quality/quality-filters";
import { cn } from "@/lib/utils";

/**
 * Gráficos mínimos del tablero de calidad, en HTML y con los tokens del
 * sistema: magnitud en un solo tono (primario), estados con su color de estado
 * y siempre con etiqueta. Cada marca trae su tooltip (title) y cada gráfico
 * tiene al lado la tabla con las mismas cifras.
 */

const DAY = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" });

/** Nota promedio por día con la línea del objetivo. */
export function DailyScoreBars({
  days,
  objective,
}: {
  days: { day: string; average: number; count: number }[];
  objective: number;
}) {
  if (days.length === 0) {
    return <p className="px-5 pb-5 text-sm text-muted-foreground">Sin llamadas evaluadas en el período.</p>;
  }
  // Escala desde 50: las notas viven entre 70 y 100 y desde cero todo se ve igual.
  const floor = Math.max(0, Math.min(50, Math.floor(Math.min(...days.map((day) => day.average)) / 10) * 10));
  const height = (value: number) => `${Math.max(4, ((value - floor) / (100 - floor)) * 100)}%`;
  return (
    <div className="px-5 pb-5">
      <div className="relative flex h-40 items-end gap-[2px] border-b border-border" role="img" aria-label="Nota promedio por día">
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/40"
          style={{ bottom: height(objective) }}
          aria-hidden="true"
        >
          <span className="absolute -top-4 right-0 bg-surface pl-1 text-[11px] text-muted-foreground">Objetivo {formatScore(objective)}</span>
        </div>
        {days.map((day) => (
          <div key={day.day} className="group relative flex h-full min-w-0 flex-1 items-end">
            <div
              className={cn(
                "w-full rounded-t-[4px] transition-opacity group-hover:opacity-80",
                day.average >= objective ? "bg-primary" : "bg-primary/45",
              )}
              style={{ height: height(day.average) }}
              title={`${DAY.format(new Date(`${day.day}T12:00:00Z`))}: nota ${formatScore(day.average)} · ${day.count} llamada${day.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[11px] tabular-nums text-muted-foreground">
        {days.map((day, index) => (
          <span key={day.day} className="min-w-0 flex-1 truncate text-center">
            {days.length <= 10 || index % Math.ceil(days.length / 8) === 0 ? DAY.format(new Date(`${day.day}T12:00:00Z`)).replace(".", "") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

const SEGMENT = {
  cumple: { label: "Cumple", className: "bg-success" },
  parcial: { label: "Con obs.", className: "bg-warning" },
  noCumple: { label: "No cumple", className: "bg-danger" },
  noAplica: { label: "No aplica", className: "bg-muted-foreground/30" },
} as const;

export type SegmentKey = keyof typeof SEGMENT;

/** Barra apilada de resultados (cumple / con obs. / no cumple / no aplica). */
export function OutcomeBar({ values, className }: { values: Partial<Record<SegmentKey, number>>; className?: string }) {
  const total = Object.values(values).reduce((sum, value) => sum + (value ?? 0), 0);
  if (total === 0) return <span className="block h-2 rounded-full bg-surface-muted" aria-hidden="true" />;
  return (
    <span className={cn("flex h-2 w-full gap-[2px] overflow-hidden rounded-full", className)}>
      {(Object.keys(SEGMENT) as SegmentKey[]).map((key) => {
        const value = values[key] ?? 0;
        if (!value) return null;
        return (
          <span
            key={key}
            className={SEGMENT[key].className}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${SEGMENT[key].label}: ${value} (${formatPercent((value / total) * 100)})`}
          />
        );
      })}
    </span>
  );
}

export function OutcomeLegend({ keys = ["cumple", "parcial", "noCumple", "noAplica"] }: { keys?: SegmentKey[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", SEGMENT[key].className)} aria-hidden="true" />
          {SEGMENT[key].label}
        </li>
      ))}
    </ul>
  );
}

/** Celda del mapa de calor: un solo tono, más intenso = más cumplimiento. */
export function HeatCellView({ compliance, evaluated, label }: { compliance: number | null; evaluated: number; label: string }) {
  if (compliance === null) {
    return <span className="block rounded-md bg-surface-muted/60 py-1.5 text-center text-[11px] text-muted-foreground" title={`${label}: sin datos`}>—</span>;
  }
  const strength = compliance >= 90 ? "bg-primary text-primary-foreground" : compliance >= 75 ? "bg-primary/60 text-primary-foreground" : compliance >= 50 ? "bg-primary/30 text-foreground" : "bg-primary/10 text-foreground";
  return (
    <span
      className={cn("block rounded-md py-1.5 text-center text-[11px] font-medium tabular-nums", strength)}
      title={`${label}: ${formatPercent(compliance)} cumple · ${evaluated} llamada${evaluated === 1 ? "" : "s"}`}
    >
      {Math.round(compliance)}
    </span>
  );
}
