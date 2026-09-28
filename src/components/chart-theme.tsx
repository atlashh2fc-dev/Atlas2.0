"use client";

import { useId } from "react";

/**
 * Tema común de los gráficos (recharts), al estilo Atlas Suite: colores de los
 * tonos de la app para que se vean vivos en claro y en oscuro, barras con
 * degradado, rejilla sutil y tooltip opaco (flota sobre el gráfico).
 */

/** Paleta de series: siempre variables CSS, así cambia sola con el tema. */
export const CHART_COLOR = {
  primary: "var(--primary)",
  blue: "var(--tone-blue)",
  teal: "var(--tone-teal)",
  green: "var(--tone-green)",
  amber: "var(--tone-amber)",
  violet: "var(--tone-violet)",
  rose: "var(--tone-rose)",
  slate: "var(--tone-slate)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  muted: "var(--muted-foreground)",
} as const;

export type ChartColor = keyof typeof CHART_COLOR;

export const CHART_TOOLTIP_STYLE = {
  background: "var(--surface-solid)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "0 12px 32px -12px var(--shadow-ambient), 0 2px 6px var(--shadow-contact)",
};

export const CHART_TOOLTIP_LABEL_STYLE = { color: "var(--foreground)", fontWeight: 600 };

/** Cursor del tooltip: una banda tenue del color de marca, no un bloque gris. */
export const CHART_CURSOR = { fill: "color-mix(in srgb, var(--primary) 8%, transparent)" };

export const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

/** Rejilla sutil: línea punteada con el borde del tema. */
export const CHART_GRID = { strokeDasharray: "3 4", stroke: "var(--border)" } as const;

export const CHART_LEGEND_STYLE = { fontSize: 12, color: "var(--muted-foreground)" };

/** Id seguro para `url(#...)`: useId trae caracteres que no sirven en un selector. */
export function useChartId(prefix = "chart") {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Referencia al degradado de un color dentro de un gráfico. */
export const gradientUrl = (chartId: string, color: ChartColor) => `url(#${chartId}-${color})`;

/**
 * Degradados de los colores usados en un gráfico. Van dentro del `<BarChart>`
 * o `<AreaChart>` como hijo directo. `bars` = pleno a translúcido en la
 * dirección de la barra; `area` = relleno que se desvanece hacia abajo.
 */
export function chartGradients(
  chartId: string,
  colors: readonly ChartColor[],
  variant: "vertical-bars" | "horizontal-bars" | "area" = "vertical-bars",
) {
  const horizontal = variant === "horizontal-bars";
  const [from, to] = variant === "area" ? [0.38, 0.02] : [1, 0.62];
  return (
    <defs>
      {colors.map((color) => (
        <linearGradient
          key={color}
          id={`${chartId}-${color}`}
          x1={horizontal ? 1 : 0}
          y1={0}
          x2={0}
          y2={horizontal ? 0 : 1}
        >
          <stop offset="0%" style={{ stopColor: CHART_COLOR[color], stopOpacity: from }} />
          <stop offset="100%" style={{ stopColor: CHART_COLOR[color], stopOpacity: to }} />
        </linearGradient>
      ))}
    </defs>
  );
}
