import { ChartDownloadButton } from "@/components/chart-download-button";
import {
  UNCLASSIFIED_RESULT,
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
  [UNCLASSIFIED_RESULT]: {
    bar: "var(--muted-foreground)",
    text: "text-muted-foreground",
    label: "Sin clasificar",
  },
};

function tone(result: string) {
  return (
    RESULT_TONE[result] ?? {
      bar: "var(--muted-foreground)",
      text: "text-muted-foreground",
      label: result,
    }
  );
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

function fmtPct(n: number): string {
  return `${n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function GroupBlock({ group }: { group: TipificationGroup }) {
  const palette = tone(group.result);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className={`text-xs font-semibold uppercase tracking-wide ${palette.text}`}>
          {palette.label}
        </h4>
        <p className="text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{fmtInt(group.count)}</span>
          {" · "}
          {fmtPct(group.share)}
        </p>
      </div>

      <ul className="mt-2 space-y-1.5">
        {group.reasons.map((detail) => (
          <li key={detail.reason}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-foreground">{detail.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {fmtInt(detail.count)}
                {" · "}
                {fmtPct(detail.share)}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, detail.share)}%`, background: palette.bar }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Desglose de tipificaciones por resultado. Muestra todos los motivos del
 * período, no un top diez: el motivo raro que aparece tres veces es
 * justamente el que hay que ver.
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
        <p className="mt-4 text-xs text-muted-foreground">Sin gestiones tipificadas en el período.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <ChartDownloadButton
          filename="tipificaciones-por-resultado.xlsx"
          rows={tipificationExportRows(breakdown)}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {fmtInt(breakdown.total)} gestiones tipificadas, agrupadas por el resultado que declara cada
        cierre.
      </p>

      {/* Proporción del período de un vistazo, antes del detalle motivo a motivo. */}
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-muted">
        {breakdown.groups.map((group) => (
          <div
            key={group.result}
            title={`${tone(group.result).label}: ${fmtInt(group.count)}`}
            style={{ width: `${group.share}%`, background: tone(group.result).bar }}
          />
        ))}
      </div>

      <div className="mt-5 space-y-5">
        {breakdown.groups.map((group) => (
          <GroupBlock key={group.result} group={group} />
        ))}
      </div>
    </div>
  );
}
