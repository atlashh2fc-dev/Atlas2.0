/**
 * Glosario único de métricas y jerga de contact center.
 *
 * Regla del producto: ninguna sigla se muestra sin definición accesible
 * (docs/auditoria-vistas-workplace.md §6). Toda columna o KPI que use una de
 * estas claves debe rendearse con `<MetricLabel id="…" />`, y el Centro de
 * ayuda publica este mismo glosario.
 */

/**
 * Dirección de la campaña a la que aplica una métrica.
 *
 * No es cosmético: mostrar "nivel de servicio a 20 s" en una campaña que solo
 * origina llamadas induce a error, porque ahí nadie espera en cola. Y varias
 * métricas homónimas miden cosas distintas según la dirección (ver `abandono`).
 */
export type MetricChannel = "outbound" | "inbound";

export type MetricDefinition = {
  /** Nombre corto que se muestra en la interfaz. */
  label: string;
  /** Qué mide, en una frase, sin jerga. */
  definition: string;
  /** Cómo se calcula, cuando ayuda a confiar en el número. */
  formula?: string;
  /**
   * Direcciones donde la métrica tiene sentido. Si se omite, aplica a ambas
   * (es el caso de las métricas de la persona: adherencia, AUX, ocupación).
   */
  channels?: MetricChannel[];
  /**
   * Matiz cuando la misma métrica cambia de significado según la dirección.
   */
  channelNote?: Partial<Record<MetricChannel, string>>;
};

export const METRIC_DEFINITIONS = {
  aht: {
    label: "AHT",
    definition: "Tiempo promedio que dura la atención completa de una llamada.",
    formula: "(tiempo en conversación + tiempo de cierre) ÷ llamadas atendidas",
  },
  talk_time: {
    label: "Tiempo en conversación",
    definition: "Suma del tiempo hablando con clientes, sin contar el cierre posterior.",
  },
  acw: {
    label: "Cierre de llamada",
    definition: "Tiempo después de colgar en que el ejecutivo tipifica y deja notas. En inglés, ACW.",
  },
  interrupcion_legal: {
    label: "Interrupción legal",
    definition:
      "Pausa obligatoria entre llamadas que exige la normativa. El discador no entrega llamadas durante ese lapso.",
  },
  ocupacion: {
    label: "Ocupación",
    definition: "Parte del tiempo conectado que el ejecutivo pasa efectivamente trabajando llamadas.",
    formula: "(conversación + cierre) ÷ tiempo conectado",
  },
  adherencia: {
    label: "Adherencia",
    definition:
      "Parte del tiempo disponible para recibir llamadas respecto del tiempo que debía estarlo. Excluye desconexiones del sistema.",
    formula: "tiempo disponible ÷ tiempo en motivos no-sistema",
  },
  abandono: {
    label: "Abandono",
    definition:
      "Llamadas conectadas que nadie alcanzó a atender y el cliente cortó. Se vigila por normativa.",
    formula: "llamadas abandonadas ÷ llamadas contestadas",
    channelNote: {
      outbound:
        "Es el costo del discado predictivo: el motor marcó de más y no había ejecutivo libre cuando el cliente contestó. Mide sobremarcación, no calidad de atención.",
      inbound:
        "Es el cliente que llamó, esperó en cola y se cansó antes de que lo atendieran. Mide dimensionamiento del turno.",
    },
  },
  nivel_servicio_20s: {
    label: "Nivel de servicio 20 s",
    definition: "Porcentaje de llamadas atendidas en menos de 20 segundos de espera.",
    // En outbound no hay cola donde esperar: el cliente contesta y se le pasa
    // un ejecutivo o se abandona la llamada. La métrica no tiene sujeto.
    channels: ["inbound"],
  },
  asa: {
    label: "Espera promedio",
    definition: "Cuánto espera en promedio un cliente antes de que alguien atienda. En inglés, ASA.",
    channels: ["inbound"],
  },
  contactabilidad: {
    label: "Contactabilidad",
    definition: "Parte de los registros trabajados en que se logró hablar con la persona.",
    formula: "contactos efectivos ÷ registros recorridos",
    channels: ["outbound"],
  },
  ring_promedio: {
    label: "Timbrado promedio",
    definition: "Segundos que suena el teléfono del cliente antes de que contesten o se corte.",
    channels: ["outbound"],
  },
  penetracion_base: {
    label: "Penetración de base",
    definition: "Parte de la base de la campaña que ya se intentó contactar al menos una vez.",
    formula: "registros con al menos un intento ÷ base total",
    channels: ["outbound"],
  },
  intentos_por_contacto: {
    label: "Intentos por contacto",
    definition:
      "Cuántas marcaciones cuesta cada conversación efectiva. Delata bases de mala calidad o reintentos mal parametrizados.",
    formula: "intentos de discado ÷ contactos efectivos",
    channels: ["outbound"],
  },
  registros_agotados: {
    label: "Registros agotados",
    definition:
      "Registros que llegaron al tope de reintentos sin lograr contacto. Es base que hay que reciclar o dar de baja.",
    channels: ["outbound"],
  },
  etapa_flujo: {
    label: "Etapa del flujo",
    definition: "En qué paso del flujo de gestión quedó el registro tras la última interacción.",
  },
  base_disponible: {
    label: "Base disponible",
    definition: "Registros de la campaña que aún se pueden marcar hoy, según reintentos y ventanas horarias.",
  },
  tmo: {
    label: "TMO",
    definition:
      "Tiempo medio de operación: lo mismo que AHT, la duración promedio de la atención completa de una llamada.",
    formula: "(tiempo en conversación + tiempo de cierre) ÷ llamadas atendidas",
  },
  aux: {
    label: "AUX",
    definition:
      "Estado en que el ejecutivo sale de la cola por un motivo declarado (colación, baño, capacitación). No recibe llamadas y el tiempo resta adherencia.",
  },
  sla: {
    label: "SLA",
    definition: "Compromiso de servicio acordado: el plazo dentro del cual una gestión o una llamada debe atenderse.",
  },
  uf: {
    label: "UF",
    definition: "Unidad de Fomento: la unidad reajustable en que se expresan los montos comerciales.",
  },
  pipeline: {
    label: "Embudo comercial",
    definition: "Suma de las oportunidades abiertas que todavía no se ganan ni se pierden.",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricId = keyof typeof METRIC_DEFINITIONS;

export function metricDefinition(id: MetricId): MetricDefinition {
  return METRIC_DEFINITIONS[id];
}

/** Dirección declarada de una campaña; `blending` reporta ambas familias. */
export type CampaignDirection = "outbound" | "inbound" | "blending";

export const CAMPAIGN_DIRECTION_LABELS: Record<CampaignDirection, string> = {
  outbound: "Saliente",
  inbound: "Entrante",
  blending: "Mixta",
};

/**
 * Si la métrica corresponde a una campaña de esta dirección.
 *
 * Sin `channels` declarados se asume que aplica a ambas: son las métricas de la
 * persona (adherencia, AUX, ocupación), que miden lo mismo marque o atienda.
 * `blending` acepta todo, porque la operación hace las dos cosas.
 */
export function metricAppliesTo(id: MetricId, direction: CampaignDirection): boolean {
  const channels = (METRIC_DEFINITIONS[id] as MetricDefinition).channels;
  if (!channels || channels.length === 0) return true;
  if (direction === "blending") return true;
  return channels.includes(direction);
}

/** Matiz de la métrica en esa dirección, cuando cambia de significado. */
export function metricChannelNote(
  id: MetricId,
  direction: CampaignDirection
): string | null {
  if (direction === "blending") return null;
  const note = (METRIC_DEFINITIONS[id] as MetricDefinition).channelNote;
  return note?.[direction] ?? null;
}

/** Glosario ordenado alfabéticamente, para el Centro de ayuda. */
export function metricGlossary(): (MetricDefinition & { id: MetricId })[] {
  return (Object.keys(METRIC_DEFINITIONS) as MetricId[])
    .map((id) => ({ id, ...METRIC_DEFINITIONS[id] }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}
