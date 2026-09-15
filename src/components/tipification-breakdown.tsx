"use client";

import { useState } from "react";
import { ChartDownloadButton } from "@/components/chart-download-button";
import {
  tipificationExportRows,
  type TipificationBreakdown as Breakdown,
  type TipificationGroup,
} from "@/lib/tipification-breakdown";

/**
 * Cada resultado tiene un color propio y estable. Que "interesa" sea siempre
 * verde y "no interesa" siempre rojo es lo que permite leer el panel de un
 * vistazo sin ir a la leyenda.
 */
const RESULT_TONE: Record<string, { bar: string; text: string; label: string }> = {
  INTERESADO: { bar: "var(--success)", text: "text-[color:var(--success)]", label: "Interesa" },
  "NO INTERESADO": { bar: "var(--danger)", text: "text-[color:var(--danger)]", label: "No interesa" },
  "NO CONTACTO": { bar: "var(--warning)", text: "text-[color:var(--warning)]", label: "No contacto" },
};

/** Cuántos motivos se muestran antes de plegar el resto. */
const VISIBLE_REASONS = 5;

function tone(result: string) {
  return (
    RESULT_TONE[result] ?? {
      bar: "var(--muted-foreground)",
      text: "text-muted-foreground",
      label: result,
    }
  );
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtPct = (n: number) =>
  `${n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * Una columna por resultado. En vez de una lista vertical de veinte motivos,
 * los resultados van lado a lado: la comparación que importa (cuánto interesa
 * contra cuánto no) se lee sin recorrer la pantalla.
 */
function ResultColumn({ group, total }: { group: TipificationGroup; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const palette = tone(group.result);
  const hidden = group.reasons.length - VISIBLE_REASONS;
  const shown = expanded ? group.reasons : group.reasons.slice(0, VISIBLE_REASONS);
  const share = total > 0 ? (group.count / total) * 100 : 0;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-muted/30 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${palette.text}`}>
          {palette.label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{fmtPct(share)}</span>
      </div>

      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {fmtInt(group.count)}
      </p>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, share)}%`, background: palette.bar }}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {shown.map((detail) => (
          <li key={detail.reason} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground" title={detail.label}>
              {detail.label}
            </span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
              {fmtInt(detail.count)}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 self-start text-[11px] font-medium text-primary hover:underline"
        >
          {expanded ? "Ver menos" : `+${hidden} motivo${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

/**
 * Desglose de tipificaciones por resultado: interesa, no interesa y no
 * contacto. Toda gestión cae en uno de los tres, así que la proporción cubre
 * el período completo.
 */
export function TipificationBreakdown({
  breakdown,
  title = "Tipificaciones por resultado",
}: {
  breakdown: Breakdown;
  title?: string;
}) {
  if (breakdown.total === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-4 text-xs text-muted-foreground">
          Sin gestiones tipificadas en el período.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fmtInt(breakdown.total)} gestiones tipificadas en el período.
          </p>
        </div>
        <ChartDownloadButton
          filename="tipificaciones-por-resultado.xlsx"
          rows={tipificationExportRows(breakdown)}
        />
      </div>

      {/* Proporción del período de un vistazo, antes del detalle. */}
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-muted">
        {breakdown.groups.map((group) => (
          <div
            key={group.result}
            title={`${tone(group.result).label}: ${fmtInt(group.count)}`}
            style={{ width: `${group.share}%`, background: tone(group.result).bar }}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {breakdown.groups.map((group) => (
          <ResultColumn key={group.result} group={group} total={breakdown.total} />
        ))}
      </div>
    </div>
  );
}
