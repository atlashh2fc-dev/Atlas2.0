// Agrupa las tipificaciones del período por su resultado comercial.
//
// El tablero mostraba una sola barra por motivo, así que "interesa" y "no
// interesa" quedaban mezclados entre veinte etiquetas y había que sumarlos a
// mano. La cascada de cierre ya clasifica cada motivo (Estado -> Resultado ->
// Motivo); acá solo se aprovecha esa clasificación que ya existe.

import { CALL_REASONS, getReasonConfig } from "./call-typification.ts";

/** Resultado sin clasificar: motivos que vienen del workflow de una campaña
 *  y no del catálogo de cierre, así que no declaran interés. */
export const UNCLASSIFIED_RESULT = "SIN CLASIFICAR";

/** Orden de lectura del tablero: primero lo que convierte. */
const RESULT_ORDER = ["INTERESADO", "NO INTERESADO", "NO CONTACTO", UNCLASSIFIED_RESULT];

const REASON_LABEL = new Map(CALL_REASONS.map((reason) => [reason.value, reason.label]));

export interface TipificationRow {
  reason: string;
  count: number;
}

export interface TipificationDetail {
  reason: string;
  label: string;
  count: number;
  /** Participación dentro de su propio resultado, no del total. */
  share: number;
}

export interface TipificationGroup {
  result: string;
  count: number;
  /** Participación sobre el total tipificado del período. */
  share: number;
  reasons: TipificationDetail[];
}

export interface TipificationBreakdown {
  total: number;
  groups: TipificationGroup[];
}

/**
 * Etiqueta legible de un motivo. El catálogo de cierre cubre los comerciales;
 * los de una cartera vienen del workflow, así que se formatean en vez de
 * mostrarse en mayúsculas como los guarda la base.
 */
export function tipificationLabel(value: string): string {
  const known = REASON_LABEL.get(value);
  if (known) return known;
  const text = value.trim();
  if (!text) return "Sin tipificar";
  const lower = text.toLocaleLowerCase("es");
  return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

/**
 * Agrupa por resultado y ordena de mayor a menor dentro de cada grupo.
 * Los conteos negativos o no numéricos se descartan: un reporte no inventa
 * gestiones y tampoco debe caerse por un dato sucio.
 */
export function groupTipificationsByResult(rows: TipificationRow[]): TipificationBreakdown {
  const buckets = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const count = Number(row?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const reason = String(row?.reason ?? "").trim();
    if (!reason) continue;

    const result = getReasonConfig(reason)?.resultLabel ?? UNCLASSIFIED_RESULT;
    const bucket = buckets.get(result) ?? new Map<string, number>();
    bucket.set(reason, (bucket.get(reason) ?? 0) + count);
    buckets.set(result, bucket);
  }

  let total = 0;
  for (const bucket of buckets.values()) {
    for (const count of bucket.values()) total += count;
  }

  const groups: TipificationGroup[] = [...buckets.entries()]
    .map(([result, bucket]) => {
      const groupTotal = [...bucket.values()].reduce((sum, count) => sum + count, 0);
      const reasons = [...bucket.entries()]
        .map(([reason, count]) => ({
          reason,
          label: tipificationLabel(reason),
          count,
          share: share(count, groupTotal),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
      return { result, count: groupTotal, share: share(groupTotal, total), reasons };
    })
    .sort((a, b) => {
      const orderA = RESULT_ORDER.indexOf(a.result);
      const orderB = RESULT_ORDER.indexOf(b.result);
      // Un resultado desconocido va al final, nunca antes de los conocidos.
      if (orderA !== orderB) return (orderA < 0 ? RESULT_ORDER.length : orderA) - (orderB < 0 ? RESULT_ORDER.length : orderB);
      return b.count - a.count;
    });

  return { total, groups };
}

/** Filas planas para el botón de descarga, con el resultado ya resuelto. */
export function tipificationExportRows(breakdown: TipificationBreakdown) {
  return breakdown.groups.flatMap((group) =>
    group.reasons.map((detail) => ({
      Resultado: group.result,
      Tipificación: detail.label,
      Cantidad: detail.count,
      "% del resultado": Number(detail.share.toFixed(1)),
      "% del total": Number(share(detail.count, breakdown.total).toFixed(1)),
    })),
  );
}
