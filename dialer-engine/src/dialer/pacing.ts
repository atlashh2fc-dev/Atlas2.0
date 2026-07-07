/**
 * Pacing simple por campaña: cuántas llamadas nuevas originar en este tick.
 *
 * capacidad = ceil(agentes_disponibles * ratio) - intentos_en_vuelo
 *
 * - dial_mode = 'preview'/'progressive' con ratio ~1.0-1.2: casi 1 llamada
 *   por agente libre, abandono bajo. Es el punto de partida recomendado.
 * - dial_mode = 'predictive' con ratio > 1.3: origina más llamadas que
 *   agentes libres apostando a que no todas contesten. Requiere medir tasa
 *   de abandono real antes de subir el ratio — no activarlo a ciegas con
 *   20 ejecutivos nuevos en la campaña.
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

/**
 * Ajuste real de ratio para dial_mode='predictive': antes las 4 fórmulas de
 * pacing (manual/preview/progressive/predictive) compartían exactamente el
 * mismo cálculo de computeDialCapacity con un ratio fijo (max_dial_ratio) —
 * "predictivo" no hacía nada distinto de "progresivo" salvo permitir un
 * número más alto a mano. Ahora, en modo predictivo, el ratio arranca
 * conservador (1.1) y se corrige con la tasa de abandono medida en los
 * últimos minutos: sube de a poco si hay margen (abandono bien por debajo
 * del objetivo) y baja rápido si se pasa del objetivo — nunca por encima
 * del techo que el admin configuró (max_dial_ratio) ni por debajo de 1.0
 * (nunca marcar menos llamadas que agentes libres).
 */
export function computeEffectiveRatio(params: {
  campaignId: string;
  dialMode: string;
  baseRatio: number;
  targetAbandonmentRate: number;
  measuredAbandonmentRate: number | null;
}): number {
  if (params.dialMode !== "predictive") {
    currentRatioByCampaign.delete(params.campaignId);
    return params.baseRatio;
  }

  const floor = 1.0;
  const ceiling = Math.max(floor, params.baseRatio);
  const previous = currentRatioByCampaign.get(params.campaignId) ?? Math.min(1.1, ceiling);

  let next = previous;
  if (params.measuredAbandonmentRate == null) {
    // Sin volumen suficiente todavía para medir abandono real (campaña
    // recién arrancada en predictivo, o pausada hace rato) — no asumir
    // nada, quedarse en el arranque conservador.
    next = Math.min(1.1, ceiling);
  } else if (params.measuredAbandonmentRate > params.targetAbandonmentRate) {
    next = previous * 0.9;
  } else if (params.measuredAbandonmentRate < params.targetAbandonmentRate * 0.7) {
    next = previous * 1.05;
  }

  next = Math.max(floor, Math.min(ceiling, next));
  currentRatioByCampaign.set(params.campaignId, next);
  return next;
}
