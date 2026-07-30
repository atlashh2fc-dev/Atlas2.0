/**
 * Glosario único de métricas y jerga de contact center.
 *
 * Regla del producto: ninguna sigla se muestra sin definición accesible
 * (docs/auditoria-vistas-workplace.md §6). Toda columna o KPI que use una de
 * estas claves debe rendearse con `<MetricLabel id="…" />`, y el Centro de
 * ayuda publica este mismo glosario.
 */

export type MetricDefinition = {
  /** Nombre corto que se muestra en la interfaz. */
  label: string;
  /** Qué mide, en una frase, sin jerga. */
  definition: string;
  /** Cómo se calcula, cuando ayuda a confiar en el número. */
  formula?: string;
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
      "Llamadas que el discador conectó pero nadie atendió, y el cliente cortó. Se vigila por normativa: sobre 6 % es alerta.",
    formula: "llamadas abandonadas ÷ llamadas contestadas",
  },
  nivel_servicio_20s: {
    label: "Nivel de servicio 20 s",
    definition: "Porcentaje de llamadas atendidas en menos de 20 segundos de espera.",
  },
  asa: {
    label: "Espera promedio",
    definition: "Cuánto espera en promedio un cliente antes de que alguien atienda. En inglés, ASA.",
  },
  contactabilidad: {
    label: "Contactabilidad",
    definition: "Parte de los registros trabajados en que se logró hablar con la persona.",
    formula: "contactos efectivos ÷ registros recorridos",
  },
  ring_promedio: {
    label: "Timbrado promedio",
    definition: "Segundos que suena el teléfono del cliente antes de que contesten o se corte.",
  },
  etapa_flujo: {
    label: "Etapa del flujo",
    definition: "En qué paso del flujo de gestión quedó el registro tras la última interacción.",
  },
  base_disponible: {
    label: "Base disponible",
    definition: "Registros de la campaña que aún se pueden marcar hoy, según reintentos y ventanas horarias.",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricId = keyof typeof METRIC_DEFINITIONS;

export function metricDefinition(id: MetricId): MetricDefinition {
  return METRIC_DEFINITIONS[id];
}

/** Glosario ordenado alfabéticamente, para el Centro de ayuda. */
export function metricGlossary(): (MetricDefinition & { id: MetricId })[] {
  return (Object.keys(METRIC_DEFINITIONS) as MetricId[])
    .map((id) => ({ id, ...METRIC_DEFINITIONS[id] }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}
