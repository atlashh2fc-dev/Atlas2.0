// Agrupa las tipificaciones del período por su resultado comercial.
//
// El tablero mostraba una sola barra por motivo, así que "interesa" y "no
// interesa" quedaban mezclados entre veinte etiquetas y había que sumarlos a
// mano. La cascada de cierre ya clasifica cada motivo (Estado -> Resultado ->
// Motivo); acá solo se aprovecha esa clasificación que ya existe.
//
// Toda gestión cae en uno de los tres resultados. Un grupo "sin clasificar"
// dejaba fuera de la comparación a un cuarto de las gestiones, así que lo que
// ninguna fuente resuelve se cuenta como no interesa (ver FALLBACK_RESULT).

import { CALL_REASONS, getReasonConfig } from "./call-typification.ts";

/** Orden de lectura del tablero: primero lo que convierte. */
const RESULT_ORDER = ["INTERESADO", "NO INTERESADO", "NO CONTACTO"];

/**
 * Destino de lo que ni el workflow, ni el catálogo, ni el cierre clasifican.
 * Si hubo contacto y nadie declaró interés, el negocio no lo cuenta como
 * interés; y si no hubo contacto, el cierre ya lo resolvió antes de llegar acá.
 */
const FALLBACK_RESULT = "NO INTERESADO";

const REASON_LABEL = new Map(CALL_REASONS.map((reason) => [reason.value, reason.label]));

export interface TipificationRow {
  reason: string;
  count: number;
  /**
   * Estado y resultado que el cierre dejó grabados en la llamada. Son la
   * declaración del workflow de la campaña, materializada por gestión: cuando
   * un ejecutivo cierra, `closeCall` arma el catálogo desde los pasos del
   * workflow y persiste estos dos campos junto al motivo. Están poblados en el
   * 100 % de las gestiones, así que son la fuente correcta para decidir si una
   * tipificación significa interés, en vez de reconocer el texto del motivo.
   * Opcionales porque una RPC antigua puede no devolverlos todavía.
   */
  status?: string | null;
  outcome?: string | null;
  /**
   * Resultado que declara el nodo del workflow al que cuelga este motivo
   * (`workflow_steps.result_kind`). Es lo más específico que existe: lo declara
   * el administrador que arma la cascada de la campaña, así que manda sobre
   * todo lo demás.
   */
  declaredResult?: string | null;
}

/** Traduce la declaración del workflow al vocabulario del tablero. */
const DECLARED_TO_RESULT: Record<string, string> = {
  interesado: "INTERESADO",
  no_interesado: "NO INTERESADO",
  no_contacto: "NO CONTACTO",
};

/**
 * Resultado fijo por motivo, decidido por el negocio para el tablero.
 *
 * Cubre los motivos de workflow que cuelgan de nodos mixtos ("Conecta",
 * "Estado del contacto"): esos nodos agrupan opciones de distinto resultado,
 * así que no pueden declarar `result_kind` y el cierre las graba como
 * `connected/other`. También corrige al catálogo donde el tablero lo cuenta
 * distinto: "Numero erroneo / no corresponde" se cierra como contacto no
 * interesado, pero no hubo contacto con la persona buscada. La cascada de
 * cierre no se toca. Las claves van normalizadas (ver normalizeReason).
 */
const REASON_RESULT_OVERRIDE: Record<string, string> = {
  "NUMERO ERRONEO": "NO CONTACTO",
  "NUMERO ERRONEO / NO CORRESPONDE": "NO CONTACTO",
  "CORTA LLAMADA": "NO INTERESADO",
  "ENVIAR INFORMACION": "INTERESADO",
};

/** Mayúsculas sin acentos, igual que la RPC compara el motivo contra su nodo. */
function normalizeReason(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleUpperCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

/** Desenlaces que declaran interés. Son los mismos a los que el catálogo
 *  comercial le asigna `resultLabel` INTERESADO, así que no introducen un
 *  criterio nuevo: lo extienden a las campañas con workflow propio. */
const INTERESTED_OUTCOMES = new Set(["sale", "interested", "callback"]);

/**
 * Resuelve el grupo desde lo que el cierre dejó grabado.
 *
 * Devuelve null cuando la gestión fue efectiva pero su desenlace quedó en
 * `other`, que es justamente el caso que el workflow no clasificó.
 */
function resultFromClosure(status?: string | null, outcome?: string | null): string | null {
  if (!status) return null;
  if (status !== "connected") return "NO CONTACTO";
  if (outcome && INTERESTED_OUTCOMES.has(outcome)) return "INTERESADO";
  if (outcome === "not_interested") return "NO INTERESADO";
  return null;
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

    // Orden de autoridad, de más específico a más genérico:
    //
    // 1. Lo que declaró el administrador en el nodo del workflow de ESTA
    //    campaña. Nadie sabe mejor que él qué significa "Acuerdo de pago".
    // 2. El resultado fijo por motivo que decidió el negocio para el tablero.
    // 3. El catálogo comercial heredado, para los motivos que ya conoce.
    // 4. El desenlace que grabó el cierre.
    // 5. No interesa, para que ninguna gestión quede fuera de la comparación.
    //
    // Que el catálogo vaya antes que el cierre no es un detalle: "No es el
    // momento" se cierra como `callback` igual que "Volver a llamar", pero el
    // negocio lo cuenta como NO INTERESADO. Hay un test que recorre el catálogo
    // entero y falla si alguien agrega otro motivo con esa contradicción.
    const declared = row?.declaredResult ? DECLARED_TO_RESULT[row.declaredResult] : undefined;
    const result =
      declared ??
      REASON_RESULT_OVERRIDE[normalizeReason(reason)] ??
      getReasonConfig(reason)?.resultLabel ??
      resultFromClosure(row?.status, row?.outcome) ??
      FALLBACK_RESULT;
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
    .sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result));

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
