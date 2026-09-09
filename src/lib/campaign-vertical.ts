import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vertical de negocio de una campaña.
 *
 * Atlas nació hablando de venta: "ventas en validación", "cotizaciones", "UF en
 * pipeline", "BBDD asignada". Una operación de cobranza mide lo mismo pero se
 * llama distinto —cartera, compromiso de pago, convenio, recuperación— y un
 * cliente de cobranza que ve "ventas" en su tablero concluye, con razón, que el
 * CRM no es para él.
 *
 * En vez de renombrar para todos (rompería a Equifax) o cablear una campaña en
 * el código (deuda técnica que no escala a la próxima cartera), el vocabulario
 * viaja en `campaigns.vertical` y cada pantalla lo lee desde acá.
 */
export type CampaignVertical = "ventas" | "cobranza";

export const CAMPAIGN_VERTICALS: { value: CampaignVertical; label: string; description: string }[] = [
  {
    value: "ventas",
    label: "Ventas",
    description: "Prospección y cierre comercial: cotizaciones, ventas y UF en pipeline.",
  },
  {
    value: "cobranza",
    label: "Cobranza",
    description: "Recuperación de cartera: compromisos, convenios y monto recuperado.",
  },
];

export function parseCampaignVertical(value: unknown): CampaignVertical {
  return value === "cobranza" ? "cobranza" : "ventas";
}

export type CampaignVocabulary = {
  vertical: CampaignVertical;
  /** Cómo se llama el registro que se trabaja. */
  record: { singular: string; plural: string };
  /** Qué es la base cargada. */
  base: string;
  kpi: {
    gestiones: string;
    contactabilidad: string;
    /** Cierre que vale plata. */
    cierre: string;
    cierreNota: string;
    /** Paso previo al cierre. */
    intermedio: string;
    conversion: string;
    monto: string;
    agendas: string;
    agendasVencidas: string;
    agendasVencidasDetalle: string;
  };
  /** Renombre de las etapas que arma el backend en el embudo. */
  funnelStage: Record<string, string>;
  agendaTitle: string;
  tipificacionesTitle: string;
  motivosTitle: string;
  evolucionTitle: string;
  /** Nota al pie del tablero: qué significa realmente el cierre. */
  disclaimer: string;
};

const VENTAS: CampaignVocabulary = {
  vertical: "ventas",
  record: { singular: "registro", plural: "registros" },
  base: "Base del equipo",
  kpi: {
    gestiones: "Gestiones",
    contactabilidad: "Contactabilidad",
    cierre: "Ventas en validación",
    cierreNota: "Ventas",
    intermedio: "Cotizaciones",
    conversion: "Tasa de conversión",
    monto: "UF en pipeline",
    agendas: "Agendas creadas",
    agendasVencidas: "Agendas vencidas",
    agendasVencidasDetalle: "Compromisos pendientes de recuperar",
  },
  funnelStage: {},
  agendaTitle: "Agenda y seguimientos",
  tipificacionesTitle: "Tipificaciones · top 10",
  motivosTitle: "Motivos de gestión",
  evolucionTitle: "Evolución diaria",
  disclaimer:
    'Nota: "Venta en validación" refleja la oportunidad registrada por el ejecutivo en la tipificación, no necesariamente un cierre/facturación confirmado por backoffice.',
};

const COBRANZA: CampaignVocabulary = {
  vertical: "cobranza",
  record: { singular: "deudor", plural: "deudores" },
  base: "Cartera asignada",
  kpi: {
    gestiones: "Gestiones de cobranza",
    contactabilidad: "Contactabilidad",
    cierre: "Recuperaciones",
    cierreNota: "Recuperaciones",
    intermedio: "Compromisos de pago",
    conversion: "Tasa de recuperación",
    monto: "UF recuperada",
    agendas: "Compromisos agendados",
    agendasVencidas: "Compromisos vencidos",
    agendasVencidasDetalle: "Pagos comprometidos que no se cumplieron",
  },
  // El backend arma el embudo con los nombres del mundo comercial; acá se
  // traducen a las etapas reales del ciclo de cobranza.
  funnelStage: {
    "BBDD asignada": "Cartera activada",
    Gestionados: "Deudores gestionados",
    Contactados: "Contacto efectivo",
    "Con resultado": "Con acuerdo de pago",
    "Venta en validación": "Deuda recuperada",
    Base: "Cartera total",
    Recorridos: "Deudores recorridos",
    "CRM tipificado": "Gestiones tipificadas",
    Cotizaciones: "Compromisos de pago",
    Ventas: "Recuperaciones",
  },
  agendaTitle: "Compromisos de pago y seguimientos",
  tipificacionesTitle: "Resultados de cobranza · top 10",
  motivosTitle: "Resultados de la gestión",
  evolucionTitle: "Evolución diaria de la recuperación",
  disclaimer:
    'Nota: "Recuperación" refleja el convenio o pago que el ejecutivo registró en la tipificación; la conciliación final la confirma la tesorería del cliente.',
};

export function getCampaignVocabulary(vertical: CampaignVertical | null | undefined): CampaignVocabulary {
  return vertical === "cobranza" ? COBRANZA : VENTAS;
}

/** Traduce el nombre de una etapa del embudo al vocabulario del vertical. */
export function funnelStageLabel(vocabulary: CampaignVocabulary, name: string): string {
  return vocabulary.funnelStage[name] ?? name;
}

/**
 * Estados del lead con el nombre que usa cada operación. El valor guardado no
 * cambia: un "convertido" sigue siendo el mismo dato, pero en cobranza se lee
 * como "Recuperado", que es lo que el cliente entiende.
 */
const COBRANZA_STATUS_LABEL: Record<string, string> = {
  nuevo: "En cartera",
  en_gestion: "En gestión",
  contactado: "Contactado",
  no_contactado: "Sin contacto",
  agendado: "Compromiso agendado",
  convertido: "Recuperado",
  descartado: "Cerrado sin acuerdo",
};

export function leadStatusLabel(
  vertical: CampaignVertical,
  value: string,
  fallback: string
): string {
  if (vertical !== "cobranza") return fallback;
  return COBRANZA_STATUS_LABEL[value] ?? fallback;
}

/**
 * Ficha de deuda que viaja en `leads.extra` cuando la campaña es de cobranza.
 * La carga masiva la escribe con estas claves; si falta alguna, la pantalla
 * simplemente no muestra ese dato en vez de romperse.
 */
export type DebtSnapshot = {
  monto: number | null;
  montoUf: number | null;
  cuotas: number | null;
  diasMora: number | null;
  tramo: string | null;
  tipo: string | null;
  alumno: string | null;
  curso: string | null;
  sede: string | null;
  estado: string | null;
  vencimiento: string | null;
};

/** Claves de `extra` que ya se muestran con formato propio en la ficha. */
export const DEBT_EXTRA_KEYS: string[] = [
  "monto_deuda",
  "monto_deuda_uf",
  "cuotas_impagas",
  "dias_mora",
  "tramo_mora",
  "tipo_deuda",
  "alumno",
  "curso",
  "sede",
  "estado_cobranza",
  "vencimiento_mas_antiguo",
  "demo_tag",
];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

export function readDebtSnapshot(extra: unknown): DebtSnapshot | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const source = extra as Record<string, unknown>;
  const snapshot: DebtSnapshot = {
    monto: toNumber(source.monto_deuda),
    montoUf: toNumber(source.monto_deuda_uf),
    cuotas: toNumber(source.cuotas_impagas),
    diasMora: toNumber(source.dias_mora),
    tramo: toText(source.tramo_mora),
    tipo: toText(source.tipo_deuda),
    alumno: toText(source.alumno),
    curso: toText(source.curso),
    sede: toText(source.sede),
    estado: toText(source.estado_cobranza),
    vencimiento: toText(source.vencimiento_mas_antiguo),
  };
  // Sin monto ni mora no hay ficha de deuda que mostrar: es un lead común.
  if (snapshot.monto === null && snapshot.diasMora === null) return null;
  return snapshot;
}

export function formatClp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
}

/** Tono para el tramo de mora, para que el riesgo se vea sin leer el número. */
export function debtAgeTone(diasMora: number | null): "muted" | "warning" | "danger" {
  if (diasMora === null) return "muted";
  if (diasMora > 180) return "danger";
  if (diasMora > 60) return "warning";
  return "muted";
}

/**
 * Lee el vertical de una campaña. Devuelve 'ventas' cuando no hay campaña
 * seleccionada o cuando la fila no es visible para quien mira: el vocabulario
 * comercial es el que ya conocen todas las pantallas.
 */
export async function fetchCampaignVertical(
  supabase: SupabaseClient,
  campaignId: string | null | undefined
): Promise<CampaignVertical> {
  if (!campaignId) return "ventas";
  const { data } = await supabase
    .from("campaigns")
    .select("vertical")
    .eq("id", campaignId)
    .maybeSingle();
  return parseCampaignVertical((data as { vertical?: string } | null)?.vertical);
}
