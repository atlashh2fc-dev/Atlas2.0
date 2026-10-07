import type { AiCriterionStatus, QualityAction, QualityVerdict } from "./quality-pauta.ts";

/**
 * Cálculos del tablero de calidad. Puros: reciben las llamadas ya evaluadas y
 * devuelven cifras, para poder probarlos sin base de datos.
 *
 * Nota oficial de una llamada: la de la analista si la validó; si no, la de la
 * IA. Así el tablero se llena desde el primer día y la validación humana va
 * reemplazando a la IA llamada por llamada (lo que Genesys llama calibración).
 */

export type CallCriterion = { id: string; name: string; weight: number; status: AiCriterionStatus };

export type QualityCall = {
  recordingId: string;
  agentId: string | null;
  campaignId: string;
  startedAt: string;
  rubricKey: string;
  rubricName: string;
  /** Validada por calidad o solo evaluada por la IA. */
  source: "validada" | "ia";
  score: number | null;
  verdict: QualityVerdict;
  criticalErrors: number;
  nonCriticalErrors: number;
  criteria: CallCriterion[];
  /** Resultado de la IA por atributo, cuando existe (para calibrar). */
  aiCriteria: CallCriterion[] | null;
  aiScore: number | null;
  aiAgreement: number | null;
  action: QualityAction | null;
};

/** Llamada que cuenta para la nota: evaluable y con nota. */
export function isScored(call: QualityCall): call is QualityCall & { score: number } {
  return call.verdict !== "no_evaluable" && call.score !== null;
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Desviación estándar muestral (como DESVEST de Excel). */
export function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values) ?? 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export type QualitySummary = {
  evaluated: number;
  scored: number;
  validated: number;
  invalid: number;
  averageScore: number | null;
  /** % de llamadas con nota ≥ objetivo. */
  onTarget: number | null;
  /** PEC: % de llamadas sin error crítico (ningún «No cumple»). */
  pec: number | null;
  /** PENC: % de llamadas sin error no crítico (ningún «Cumple con obs.»). */
  penc: number | null;
  /** Coincidencia media IA ↔ analista en las llamadas validadas. */
  agreement: number | null;
  verdicts: Record<QualityVerdict, number>;
  actions: Record<QualityAction, number>;
};

export function summarize(calls: QualityCall[], objective: number): QualitySummary {
  const scored = calls.filter(isScored);
  const percent = (part: number) => (scored.length ? round((part / scored.length) * 100) : null);
  const agreements = calls.map((call) => call.aiAgreement).filter((value): value is number => value !== null);
  const verdicts: Record<QualityVerdict, number> = { cumple: 0, parcial: 0, no_cumple: 0, no_evaluable: 0 };
  const actions: Record<QualityAction, number> = {
    sin_accion: 0,
    feedback_individual: 0,
    recapacitacion_masiva: 0,
    escalar_supervision: 0,
  };
  for (const call of calls) {
    verdicts[call.verdict] += 1;
    if (call.action) actions[call.action] += 1;
  }
  const average = mean(scored.map((call) => call.score));
  return {
    evaluated: calls.length,
    scored: scored.length,
    validated: calls.filter((call) => call.source === "validada").length,
    invalid: verdicts.no_evaluable,
    averageScore: average === null ? null : round(average),
    onTarget: percent(scored.filter((call) => call.score >= objective).length),
    pec: percent(scored.filter((call) => call.criticalErrors === 0).length),
    penc: percent(scored.filter((call) => call.nonCriticalErrors === 0).length),
    agreement: agreements.length ? round((mean(agreements) ?? 0) * 100) : null,
    verdicts,
    actions,
  };
}

export type AgentScore = {
  agentId: string;
  evaluated: number;
  validated: number;
  averageScore: number;
  pec: number;
  penc: number;
  criticalErrors: number;
  nonCriticalErrors: number;
  minScore: number;
  maxScore: number;
  /** 1 = mejor cuarto del equipo; 4 = cuarto a trabajar. */
  quartile: 1 | 2 | 3 | 4;
  /** Fuera de los límites de control del equipo. */
  control: "sobre" | "dentro" | "bajo";
  meetsObjective: boolean;
};

export type AgentScorecard = {
  rows: AgentScore[];
  teamAverage: number | null;
  standardDeviation: number | null;
  /** Límites de control: promedio ± 1 desviación, como en la planilla semanal. */
  lci: number | null;
  lcs: number | null;
};

/**
 * Tabla por ejecutivo con cuartil y límites de control. El cuartil se calcula
 * por posición en el ranking de nota (Q1 = mejor 25 %); con empate, misma
 * posición. LCI/LCS = promedio de las notas de los ejecutivos ± 1 desviación.
 */
export function agentScorecard(calls: QualityCall[], objective: number): AgentScorecard {
  const byAgent = new Map<string, QualityCall[]>();
  for (const call of calls) {
    if (!call.agentId) continue;
    const list = byAgent.get(call.agentId) ?? [];
    list.push(call);
    byAgent.set(call.agentId, list);
  }

  const base = [...byAgent.entries()].flatMap(([agentId, agentCalls]) => {
    const scored = agentCalls.filter(isScored);
    if (scored.length === 0) return [];
    const scores = scored.map((call) => call.score);
    return [{
      agentId,
      evaluated: agentCalls.length,
      validated: agentCalls.filter((call) => call.source === "validada").length,
      averageScore: round(mean(scores) ?? 0),
      pec: round((scored.filter((call) => call.criticalErrors === 0).length / scored.length) * 100),
      penc: round((scored.filter((call) => call.nonCriticalErrors === 0).length / scored.length) * 100),
      criticalErrors: scored.reduce((sum, call) => sum + call.criticalErrors, 0),
      nonCriticalErrors: scored.reduce((sum, call) => sum + call.nonCriticalErrors, 0),
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
    }];
  });

  if (base.length === 0) return { rows: [], teamAverage: null, standardDeviation: null, lci: null, lcs: null };

  const averages = base.map((row) => row.averageScore);
  const teamAverage = round(mean(averages) ?? 0);
  const deviation = round(standardDeviation(averages), 2);
  const lci = round(teamAverage - deviation);
  const lcs = round(teamAverage + deviation);

  const sorted = [...base].sort((a, b) => b.averageScore - a.averageScore || b.evaluated - a.evaluated);
  const rows: AgentScore[] = sorted.map((row) => {
    const rank = sorted.findIndex((candidate) => candidate.averageScore === row.averageScore) + 1;
    const quartile = Math.min(4, Math.max(1, Math.ceil((rank / sorted.length) * 4))) as 1 | 2 | 3 | 4;
    return {
      ...row,
      quartile,
      control: deviation > 0 && row.averageScore < lci ? "bajo" : deviation > 0 && row.averageScore > lcs ? "sobre" : "dentro",
      meetsObjective: row.averageScore >= objective,
    };
  });

  return { rows, teamAverage, standardDeviation: deviation, lci, lcs };
}

export type CriterionGap = {
  id: string;
  name: string;
  rubricName: string;
  weight: number;
  evaluated: number;
  cumple: number;
  parcial: number;
  noCumple: number;
  noAplica: number;
  /** % que cumple sin observaciones entre las llamadas donde aplica. */
  compliance: number | null;
  /** Puntos de nota que se pierden en promedio por este atributo. */
  pointsLost: number;
};

const FACTOR: Record<Exclude<AiCriterionStatus, "no_observable">, number> = {
  cumple: 1,
  parcial: 0.5,
  no_cumple: 0,
  no_aplica: 1,
};

/**
 * Brechas por atributo, ordenadas por puntos de nota perdidos (Pareto): lo que
 * más baja la nota del equipo va primero, no lo que más se repite.
 */
export function criterionGaps(calls: QualityCall[]): CriterionGap[] {
  const gaps = new Map<string, CriterionGap & { lostTotal: number }>();
  const scoredCalls = calls.filter(isScored);
  for (const call of scoredCalls) {
    for (const criterion of call.criteria) {
      if (criterion.status === "no_observable") continue;
      const key = `${call.rubricKey}:${criterion.id}`;
      const gap = gaps.get(key) ?? {
        id: criterion.id,
        name: criterion.name,
        rubricName: call.rubricName,
        weight: criterion.weight,
        evaluated: 0,
        cumple: 0,
        parcial: 0,
        noCumple: 0,
        noAplica: 0,
        compliance: null,
        pointsLost: 0,
        lostTotal: 0,
      };
      gap.evaluated += 1;
      if (criterion.status === "cumple") gap.cumple += 1;
      if (criterion.status === "parcial") gap.parcial += 1;
      if (criterion.status === "no_cumple") gap.noCumple += 1;
      if (criterion.status === "no_aplica") gap.noAplica += 1;
      gap.lostTotal += criterion.weight * (1 - FACTOR[criterion.status]);
      gaps.set(key, gap);
    }
  }
  return [...gaps.values()]
    .map(({ lostTotal, ...gap }) => {
      const applicable = gap.evaluated - gap.noAplica;
      return {
        ...gap,
        compliance: applicable > 0 ? round((gap.cumple / applicable) * 100) : null,
        pointsLost: gap.evaluated ? round(lostTotal / gap.evaluated, 2) : 0,
      };
    })
    .sort((a, b) => b.pointsLost - a.pointsLost || (a.compliance ?? 100) - (b.compliance ?? 100));
}

export type HeatCell = { compliance: number | null; evaluated: number };

/** Ejecutivo × atributo (por nombre, para juntar rúbricas): % que cumple. */
export function agentCriterionMatrix(calls: QualityCall[]) {
  const criteria = new Map<string, { id: string; name: string; weight: number }>();
  const cells = new Map<string, { cumple: number; applicable: number; evaluated: number }>();
  for (const call of calls.filter(isScored)) {
    if (!call.agentId) continue;
    for (const criterion of call.criteria) {
      if (criterion.status === "no_observable") continue;
      if (!criteria.has(criterion.id)) criteria.set(criterion.id, { id: criterion.id, name: criterion.name, weight: criterion.weight });
      const key = `${call.agentId}:${criterion.id}`;
      const cell = cells.get(key) ?? { cumple: 0, applicable: 0, evaluated: 0 };
      cell.evaluated += 1;
      if (criterion.status !== "no_aplica") cell.applicable += 1;
      if (criterion.status === "cumple") cell.cumple += 1;
      cells.set(key, cell);
    }
  }
  const cell = (agentId: string, criterionId: string): HeatCell => {
    const value = cells.get(`${agentId}:${criterionId}`);
    if (!value) return { compliance: null, evaluated: 0 };
    return { compliance: value.applicable ? round((value.cumple / value.applicable) * 100) : null, evaluated: value.evaluated };
  };
  return { criteria: [...criteria.values()].sort((a, b) => b.weight - a.weight), cell };
}

export type CalibrationRow = { id: string; name: string; compared: number; agreement: number; aiStricter: number; aiLenient: number };

/**
 * Calibración: en las llamadas validadas, cuántas veces la IA coincidió con la
 * analista por atributo y hacia dónde se equivoca (más severa o más blanda).
 */
export function calibration(calls: QualityCall[]): { overall: number | null; compared: number; rows: CalibrationRow[] } {
  const rows = new Map<string, CalibrationRow & { matches: number }>();
  let compared = 0;
  let matches = 0;
  for (const call of calls) {
    if (call.source !== "validada" || !call.aiCriteria) continue;
    const ai = new Map(call.aiCriteria.map((criterion) => [criterion.id, criterion.status]));
    for (const criterion of call.criteria) {
      const aiStatus = ai.get(criterion.id);
      if (!aiStatus || aiStatus === "no_observable" || criterion.status === "no_observable") continue;
      const row = rows.get(criterion.id) ?? { id: criterion.id, name: criterion.name, compared: 0, agreement: 0, aiStricter: 0, aiLenient: 0, matches: 0 };
      row.compared += 1;
      compared += 1;
      if (aiStatus === criterion.status) {
        row.matches += 1;
        matches += 1;
      } else if (FACTOR[aiStatus] < FACTOR[criterion.status]) {
        row.aiStricter += 1;
      } else {
        row.aiLenient += 1;
      }
      rows.set(criterion.id, row);
    }
  }
  return {
    overall: compared ? round((matches / compared) * 100) : null,
    compared,
    rows: [...rows.values()]
      .map(({ matches: rowMatches, ...row }) => ({ ...row, agreement: round((rowMatches / row.compared) * 100) }))
      .sort((a, b) => a.agreement - b.agreement),
  };
}

/** Nota promedio y llamadas por día (fecha de Chile). */
export function dailyTrend(calls: QualityCall[]) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });
  const days = new Map<string, number[]>();
  for (const call of calls.filter(isScored)) {
    const day = formatter.format(new Date(call.startedAt));
    const list = days.get(day) ?? [];
    list.push(call.score);
    days.set(day, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, scores]) => ({ day, average: round(mean(scores) ?? 0), count: scores.length }));
}
