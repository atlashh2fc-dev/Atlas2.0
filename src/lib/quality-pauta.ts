/**
 * Pautas de calidad por empresa (tabla `quality_pautas`).
 *
 * Una pauta trae una o más rúbricas: atributos con peso (puntos sobre 100) y
 * definición. La rúbrica que aplica se elige por la tipificación de la
 * llamada (Equifax: «No interesa» para rechazos, «General» para el resto).
 *
 * La medición es la de la planilla del cliente:
 *   Cumple = 1 · Cumple con obs. = 0,5 · No cumple = 0 · No aplica = 1
 * Nota = Σ peso × ponderación / Σ peso, sobre 100.
 *
 * Errores: «No cumple» en un atributo es error crítico; «Cumple con obs.» es
 * error no crítico. Con eso se calculan PEC y PENC (porcentaje de llamadas sin
 * error crítico / no crítico), como en los reportes de calidad de contact center.
 *
 * Este archivo es puro: lo usan el servidor (IA y validación) y la pantalla.
 */

export type CriterionStatus = "cumple" | "parcial" | "no_cumple" | "no_aplica";
/** La IA puede además declarar que no logra observar el atributo. */
export type AiCriterionStatus = CriterionStatus | "no_observable";
export type QualityVerdict = "cumple" | "parcial" | "no_cumple" | "no_evaluable";
export type CallValidity = "valida" | "audio_incompleto" | "corte" | "no_corresponde" | "error_tecnico";
export type QualityAction = "feedback_individual" | "recapacitacion_masiva" | "escalar_supervision" | "sin_accion";

export type PautaCriterion = { id: string; name: string; weight: number; definition: string };
export type PautaRubric = { key: string; name: string; outcomes: string[]; criteria: PautaCriterion[] };
export type PautaScale = Record<CriterionStatus, number>;

export type QualityPauta = {
  id: string;
  organizationId: string;
  key: string;
  version: number;
  name: string;
  campaignIds: string[];
  status: "vigente" | "archivada";
  rubrics: PautaRubric[];
  scale: PautaScale;
  objective: number;
  minSeconds: number;
  sampleOutcomes: string[];
  dailySamplePerAgent: number;
  notes: string | null;
  sourceFilename: string | null;
  createdAt: string;
};

export const DEFAULT_SCALE: PautaScale = { cumple: 1, parcial: 0.5, no_cumple: 0, no_aplica: 1 };

export const CRITERION_STATUS_LABEL: Record<AiCriterionStatus, string> = {
  cumple: "Cumple",
  parcial: "Cumple con obs.",
  no_cumple: "No cumple",
  no_aplica: "No aplica",
  no_observable: "No observable",
};

export const CRITERION_STATUS_TONE: Record<AiCriterionStatus, "success" | "warning" | "danger" | "neutral"> = {
  cumple: "success",
  parcial: "warning",
  no_cumple: "danger",
  no_aplica: "neutral",
  no_observable: "neutral",
};

export const VERDICT_LABEL: Record<QualityVerdict, string> = {
  cumple: "Cumple",
  parcial: "Cumple con obs.",
  no_cumple: "No cumple",
  no_evaluable: "No válida",
};

export const VERDICT_TONE: Record<QualityVerdict, "success" | "warning" | "danger" | "neutral"> = {
  cumple: "success",
  parcial: "warning",
  no_cumple: "danger",
  no_evaluable: "neutral",
};

/** Causas de «Llamada no válida» de la planilla (Hoja 2). */
export const CALL_VALIDITY_LABEL: Record<CallValidity, string> = {
  valida: "Llamada válida",
  audio_incompleto: "Audio incompleto",
  corte: "Corte",
  no_corresponde: "No corresponde al cliente",
  error_tecnico: "Error técnico",
};

/** Acciones de la planilla (Hoja 2). */
export const ACTION_LABEL: Record<QualityAction, string> = {
  sin_accion: "Sin acción",
  feedback_individual: "Feedback individual",
  recapacitacion_masiva: "Recapacitación masiva",
  escalar_supervision: "Escalar a supervisión",
};

export const CALL_VALIDITIES = Object.keys(CALL_VALIDITY_LABEL) as CallValidity[];
export const QUALITY_ACTIONS = Object.keys(ACTION_LABEL) as QualityAction[];
export const CRITERION_STATUSES: CriterionStatus[] = ["cumple", "parcial", "no_cumple", "no_aplica"];

/** Clave con la que la evaluación IA queda guardada: pauta + rúbrica. */
export function pautaRubricKey(pautaKey: string, rubricKey: string) {
  return `${pautaKey}.${rubricKey}`;
}

/** Rúbrica que corresponde a la tipificación: la que la nombra, o la comodín «*». */
export function selectRubric(pauta: Pick<QualityPauta, "rubrics">, outcome: string | null): PautaRubric | null {
  const exact = outcome ? pauta.rubrics.find((rubric) => rubric.outcomes.includes(outcome)) : undefined;
  return exact ?? pauta.rubrics.find((rubric) => rubric.outcomes.includes("*")) ?? pauta.rubrics[0] ?? null;
}

export type ScoredCriterion = { id: string; status: AiCriterionStatus };

export type PautaScore = {
  /** Nota 0–100 con un decimal; null si no hay peso observable. */
  score: number | null;
  verdict: QualityVerdict;
  criticalErrors: number;
  nonCriticalErrors: number;
  /** Peso (sobre 100) que se pudo observar. */
  observedWeight: number;
};

/**
 * Nota ponderada de una llamada. Los atributos «no observable» (solo IA) salen
 * del denominador; si queda menos de la mitad del peso, la llamada no se puede
 * evaluar con confianza.
 */
export function scorePauta(
  rubric: PautaRubric,
  results: ScoredCriterion[],
  scale: PautaScale = DEFAULT_SCALE,
  validity: CallValidity = "valida",
): PautaScore {
  const byId = new Map(results.map((result) => [result.id, result.status]));
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  let observedWeight = 0;
  let earned = 0;
  let criticalErrors = 0;
  let nonCriticalErrors = 0;

  for (const criterion of rubric.criteria) {
    const status = byId.get(criterion.id) ?? "no_observable";
    if (status === "no_observable") continue;
    observedWeight += criterion.weight;
    earned += criterion.weight * (scale[status] ?? DEFAULT_SCALE[status]);
    if (status === "no_cumple") criticalErrors += 1;
    if (status === "parcial") nonCriticalErrors += 1;
  }

  const normalizedObserved = totalWeight > 0 ? (observedWeight / totalWeight) * 100 : 0;
  const score = observedWeight > 0 ? Math.round((earned / observedWeight) * 1000) / 10 : null;
  const verdict: QualityVerdict =
    validity !== "valida" || score === null || normalizedObserved < 50
      ? "no_evaluable"
      : criticalErrors > 0
        ? "no_cumple"
        : nonCriticalErrors > 0
          ? "parcial"
          : "cumple";

  return { score, verdict, criticalErrors, nonCriticalErrors, observedWeight: Math.round(normalizedObserved) };
}

/** Coincidencia IA ↔ analista: proporción de atributos con el mismo resultado. */
export function agreementRate(
  human: { id: string; status: CriterionStatus }[],
  ai: { id: string; status: AiCriterionStatus }[],
): number | null {
  const aiById = new Map(ai.map((criterion) => [criterion.id, criterion.status]));
  const comparable = human.filter((criterion) => aiById.has(criterion.id));
  if (comparable.length === 0) return null;
  const matches = comparable.filter((criterion) => aiById.get(criterion.id) === criterion.status).length;
  return Math.round((matches / comparable.length) * 1000) / 1000;
}

function asNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Fila de `quality_pautas` → objeto de dominio, tolerante con datos viejos. */
export function mapPautaRow(row: Record<string, unknown>): QualityPauta {
  const rawScale = (row.scale ?? {}) as Partial<Record<CriterionStatus, unknown>>;
  const rubrics = Array.isArray(row.rubrics) ? (row.rubrics as Record<string, unknown>[]) : [];
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    key: String(row.key),
    version: asNumber(row.version, 1),
    name: String(row.name),
    campaignIds: Array.isArray(row.campaign_ids) ? (row.campaign_ids as string[]) : [],
    status: row.status === "archivada" ? "archivada" : "vigente",
    rubrics: rubrics.map((rubric) => ({
      key: String(rubric.key),
      name: String(rubric.name),
      outcomes: Array.isArray(rubric.outcomes) ? (rubric.outcomes as string[]) : ["*"],
      criteria: (Array.isArray(rubric.criteria) ? (rubric.criteria as Record<string, unknown>[]) : []).map((criterion) => ({
        id: String(criterion.id),
        name: String(criterion.name),
        weight: asNumber(criterion.weight, 0),
        definition: String(criterion.definition ?? ""),
      })),
    })),
    scale: {
      cumple: asNumber(rawScale.cumple, DEFAULT_SCALE.cumple),
      parcial: asNumber(rawScale.parcial, DEFAULT_SCALE.parcial),
      no_cumple: asNumber(rawScale.no_cumple, DEFAULT_SCALE.no_cumple),
      no_aplica: asNumber(rawScale.no_aplica, DEFAULT_SCALE.no_aplica),
    },
    objective: asNumber(row.objective, 95),
    minSeconds: asNumber(row.min_seconds, 60),
    sampleOutcomes: Array.isArray(row.sample_outcomes) ? (row.sample_outcomes as string[]) : [],
    dailySamplePerAgent: asNumber(row.daily_sample_per_agent, 0),
    notes: typeof row.notes === "string" ? row.notes : null,
    sourceFilename: typeof row.source_filename === "string" ? row.source_filename : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export const PAUTA_COLUMNS =
  "id, organization_id, key, version, name, campaign_ids, status, rubrics, scale, objective, min_seconds, sample_outcomes, daily_sample_per_agent, notes, source_filename, created_at";

/* ------------------------------------------------------------------------ */
/* Lectura de la planilla de rúbrica                                         */
/* ------------------------------------------------------------------------ */

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export type ParsedPautaWorkbook = { rubrics: PautaRubric[]; scale: PautaScale; warnings: string[] };

/**
 * Lee la hoja de rúbricas tal como la entrega el cliente: bloques que empiezan
 * con «RUBRICA- <NOMBRE>», una fila de encabezado (Atributo, Peso, Definición)
 * y luego un atributo por fila. El peso puede venir como 0,08 o como 8.
 * Un bloque cuyo nombre contiene «NO INTERESA» se aplica a los rechazos; el
 * resto es la rúbrica comodín. Al final puede venir la tabla MEDICIÓN.
 */
export function parsePautaRows(rows: unknown[][]): ParsedPautaWorkbook {
  const rubrics: PautaRubric[] = [];
  const warnings: string[] = [];
  const scale: PautaScale = { ...DEFAULT_SCALE };
  let current: PautaRubric | null = null;
  let inScale = false;

  for (const row of rows) {
    const first = cleanText(row[0]);
    const upper = first.toUpperCase();
    if (!first) continue;

    const rubricMatch = /^R[UÚ]BRICA\s*[-–:]\s*(.+)$/i.exec(first);
    if (rubricMatch) {
      const title = cleanText(rubricMatch[1]);
      const isRejection = /NO\s+INTERES/i.test(title);
      current = {
        key: isRejection ? "no_interesa" : slug(title) || `rubrica_${rubrics.length + 1}`,
        name: `Rúbrica ${title.toLocaleLowerCase("es-CL")}`,
        outcomes: isRejection ? ["not_interested"] : ["*"],
        criteria: [],
      };
      rubrics.push(current);
      inScale = false;
      continue;
    }
    if (upper === "ATRIBUTO") continue;
    if (upper.startsWith("MEDICI")) {
      inScale = true;
      current = null;
      continue;
    }
    if (inScale) {
      const value = Number(row[1]);
      if (!Number.isFinite(value)) continue;
      if (upper === "CUMPLE") scale.cumple = value;
      else if (upper.startsWith("CUMPLE CON")) scale.parcial = value;
      else if (upper === "NO CUMPLE") scale.no_cumple = value;
      else if (upper === "NO APLICA") scale.no_aplica = value;
      continue;
    }
    if (!current) continue;

    const rawWeight = Number(String(row[1] ?? "").replace(",", "."));
    if (!Number.isFinite(rawWeight) || rawWeight <= 0) {
      warnings.push(`«${first}» no tiene un peso válido y se omitió.`);
      continue;
    }
    const weight = rawWeight <= 1 ? Math.round(rawWeight * 1000) / 10 : rawWeight;
    const baseId = slug(first) || `atributo_${current.criteria.length + 1}`;
    let id = baseId;
    let suffix = 2;
    while (current.criteria.some((criterion) => criterion.id === id)) id = `${baseId}_${suffix++}`;
    current.criteria.push({ id, name: first, weight, definition: cleanText(row[2]) });
  }

  // Una rúbrica sin comodín deja llamadas sin pauta: la primera pasa a cubrir el resto.
  if (rubrics.length > 0 && !rubrics.some((rubric) => rubric.outcomes.includes("*"))) {
    rubrics[0].outcomes = [...rubrics[0].outcomes, "*"];
  }
  for (const rubric of rubrics) {
    const total = Math.round(rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) * 10) / 10;
    if (rubric.criteria.length === 0) warnings.push(`${rubric.name} no tiene atributos.`);
    else if (total !== 100) warnings.push(`Los pesos de ${rubric.name} suman ${total}, no 100. La nota se normaliza igual.`);
  }
  return { rubrics: rubrics.filter((rubric) => rubric.criteria.length > 0), scale, warnings };
}
