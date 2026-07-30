"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { metricDefinition, type MetricId } from "@/lib/metric-definitions";

/**
 * Definición en línea. Se muestra con CSS (hover y `focus-within`), así que
 * puede usarse dentro de tablas y de componentes de servidor. El único
 * JavaScript que necesita es neutralizar el clic: muchos de estos iconos viven
 * dentro de un `<label>` o de una fila clicable.
 */
export function InfoTooltip({
  text,
  formula,
  align = "left",
  className,
}: {
  text: string;
  formula?: string;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={`Definición: ${text}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-surface p-2.5 text-left text-xs font-normal normal-case tracking-normal text-foreground opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          align === "right" ? "right-0" : "left-0"
        )}
      >
        {text}
        {formula && <span className="mt-1 block text-[11px] text-muted-foreground">{formula}</span>}
      </span>
    </span>
  );
}

/** Etiqueta de métrica tomada del glosario, con su definición al lado. */
export function MetricLabel({ id, className }: { id: MetricId; className?: string }) {
  const { label, definition, formula } = metricDefinition(id);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {label}
      <InfoTooltip text={definition} formula={formula} />
    </span>
  );
}
