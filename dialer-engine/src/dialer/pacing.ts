/**
 * Pacing simple por campaña: cuántas llamadas nuevas originar en este tick.
 *
 * capacidad = ceil(agentes_disponibles * ratio) - intentos_en_vuelo
 *
 * - dial_mode = 'preview'/'progressive' con ratio ~1.0-1.2: casi 1 llamada
 *   por agente libre, abandono bajo. Es el punto de partida recomendado.
 * - dial_mode = 'predictive': el ratio lo calcula el motor a partir de la
 *   tasa de contacto real (ver computeEffectiveRatio); max_dial_ratio pasa a
 *   ser el techo que el admin autoriza, no el valor que se usa siempre.
 */
export function computeDialCapacity(params: {
  availableAgents: number;
  ratio: number;
  inFlight: number;
  maxBatchPerTick: number;
}): number {
  const target = Math.ceil(params.availableAgents * params.ratio) - params.inFlight;
  return Math.max(0, Math.min(target, params.maxBatchPerTick));
}

// Ratio efectivo por campaña que el modo predictivo viene ajustando tick a
// tick — vive en memoria del proceso (se resetea si el motor reinicia,
// arrancando conservador de nuevo, lo cual es la opción segura).
const currentRatioByCampaign = new Map<string, number>();

/** Arranque conservador de una campaña predictiva sin historial en memoria. */
const PREDICTIVE_START_RATIO = 1.1;
/** Cuánto sube el ratio por ciclo hacia la demanda cuando hay margen de abandono. */
const GROWTH_WITH_MARGIN = 1.15;
/** Cuánto sube por ciclo cuando todavía no hay volumen para medir abandono. */
const GROWTH_WITHOUT_SIGNAL = 1.1;
/** Cuánto baja por ciclo apenas el abandono supera el objetivo. */
const SHRINK_ON_ABANDONMENT = 0.85;
/** Cuánto baja por ciclo cuando la tasa de contacto mejoró y sobran líneas. */
const SHRINK_TOWARD_DEMAND = 0.9;

/**
 * Cuántas líneas por ejecutivo libre pide la campaña según su tasa de
 * contacto: con 12 % de contacto hacen falta ~8 intentos por conversación.
 * Es lo que hacen los discadores predictivos grandes; antes el motor subía
 * de a 5 % por ciclo desde 1,1 sin mirar cuántos intentos terminaban en
 * conversación, y nunca alcanzaba a alimentar a los ejecutivos.
 */
export function contactDemandRatio(params: {
  measuredContactRate: number | null;
  floor: number;
  ceiling: number;
}): number {
  const { measuredContactRate, floor, ceiling } = params;
  if (measuredContactRate == null) return Math.min(PREDICTIVE_START_RATIO, ceiling);
  if (measuredContactRate <= 0) return ceiling;
  return Math.max(floor, Math.min(ceiling, 1 / measuredContactRate));
}

/**
 * Ratio para dial_mode='predictive'.
 *
 * Dos señales, en este orden de prioridad:
 * 1. Abandono medido (últimos minutos) contra el objetivo del admin: si se
 *    pasa, el ratio baja rápido, sin importar lo que pida la tasa de contacto.
 * 2. Tasa de contacto: cuántos intentos terminados llegaron a conversación.
 *    Define la demanda (1 / tasa) hacia la que el ratio se mueve de a poco
 *    mientras el abandono esté bien por debajo del objetivo.
 *
 * Nunca por encima del techo del admin (max_dial_ratio, que también aplica
 * claim_next_dial_targets en la base) ni por debajo de 1,0 (nunca marcar
 * menos llamadas que agentes libres). Sin volumen para medir abandono se
 * avanza igual hacia la demanda, pero más lento.
 */
export function computeEffectiveRatio(params: {
  campaignId: string;
  dialMode: string;
  baseRatio: number;
  /** Porcentaje (3 = 3 %). */
  targetAbandonmentRate: number;
  /** Porcentaje, o null sin volumen suficiente. */
  measuredAbandonmentRate: number | null;
  /** Fracción 0..1 (0.12 = 12 % de los intentos terminan en conversación), o null sin muestra. */
  measuredContactRate?: number | null;
}): number {
  if (params.dialMode !== "predictive") {
    currentRatioByCampaign.delete(params.campaignId);
    return params.baseRatio;
  }

  const floor = 1.0;
  const ceiling = Math.max(floor, params.baseRatio);
  const previous = currentRatioByCampaign.get(params.campaignId) ?? Math.min(PREDICTIVE_START_RATIO, ceiling);
  const demand = contactDemandRatio({
    measuredContactRate: params.measuredContactRate ?? null,
    floor,
    ceiling,
  });

  let next: number;
  if (params.measuredAbandonmentRate != null && params.measuredAbandonmentRate > params.targetAbandonmentRate) {
    next = previous * SHRINK_ON_ABANDONMENT;
  } else if (previous > demand) {
    // La tasa de contacto mejoró (o se corrigió la muestra): sobran líneas.
    next = Math.max(demand, previous * SHRINK_TOWARD_DEMAND);
  } else if (params.measuredAbandonmentRate == null) {
    next = Math.min(demand, previous * GROWTH_WITHOUT_SIGNAL);
  } else if (params.measuredAbandonmentRate < params.targetAbandonmentRate * 0.7) {
    next = Math.min(demand, previous * GROWTH_WITH_MARGIN);
  } else {
    // Abandono entre el 70 % y el 100 % del objetivo: zona de equilibrio.
    next = previous;
  }

  next = Math.max(floor, Math.min(ceiling, next));
  currentRatioByCampaign.set(params.campaignId, next);
  return next;
}

/** Solo para tests: olvida el ratio aprendido de una campaña. */
export function resetEffectiveRatioForTests(campaignId?: string): void {
  if (campaignId) currentRatioByCampaign.delete(campaignId);
  else currentRatioByCampaign.clear();
}
