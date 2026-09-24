// Cascada Equifax portada desde Registro Intel:
// Estado -> Resultado -> Motivo, pensada para cierre rapido de llamada.

import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";

export type CallStatus = "connected" | "no_answer" | "busy" | "voicemail" | "out_of_service";
export type CallOutcome = "sale" | "callback" | "interested" | "not_interested" | "other";
export type AgendaRequirement = "required" | "optional" | "none";

export interface CallReasonConfig {
  /** Valor exacto que se persiste en calls.reason / leads.tipificacion_actual */
  value: string;
  label: string;
  status: CallStatus;
  outcome: CallOutcome;
  agenda: AgendaRequirement;
  stateLabel: string;
  stateOrderIndex: number;
  resultLabel: string;
  resultOrderIndex: number;
  reasonOrderIndex: number;
  /**
   * Opciones intermedias del flujo entre el resultado y este motivo, en orden.
   * «No lo necesita» cuelga de «No Interesa», así que su ruta es ["No Interesa"].
   * La ficha las muestra como grupos para que el ejecutivo vea el mismo árbol
   * que armó el administrador.
   */
  groupPath?: string[];
  /**
   * Activa los campos comerciales heredados de Equifax para este cierre.
   * La misma etiqueta (por ejemplo, COTIZACION ENVIADA) puede existir en
   * otros flujos sin compartir ese contrato de datos.
   */
  requiresEquifaxData?: boolean;
  /**
   * Regla de Atlas 1 para SE ENVIA INFORMACION: la agenda es opcional, pero sin
   * agenda el cierre exige una nota que diga qué se envió y a quién; si no,
   * nadie vuelve a ese cliente. Solo bajo el contrato Equifax, igual que
   * `requiresEquifaxData`, para no cambiar otras campañas con la misma etiqueta.
   */
  notesRequiredWithoutAgenda?: boolean;
}

export const CALL_STATUSES: { value: CallStatus; label: string }[] = [
  { value: "connected", label: "Conectada" },
  { value: "no_answer", label: "No contesta" },
  { value: "busy", label: "Ocupado" },
  { value: "voicemail", label: "Buzon de voz" },
  { value: "out_of_service", label: "Fuera de servicio" },
];

export const CALL_OUTCOMES_BY_STATUS: Record<CallStatus, { value: CallOutcome; label: string }[]> = {
  connected: [
    { value: "interested", label: "Interesado" },
    { value: "not_interested", label: "No interesado" },
    { value: "callback", label: "Re-agendar / callback" },
    { value: "sale", label: "Venta" },
    { value: "other", label: "Otro" },
  ],
  no_answer: [{ value: "other", label: "Otro" }],
  busy: [{ value: "other", label: "Otro" }],
  voicemail: [{ value: "other", label: "Otro" }],
  out_of_service: [{ value: "other", label: "Otro" }],
};

export const FALLBACK_REASON = "GESTION EN CURSO";

export const CALL_REASONS: CallReasonConfig[] = ([
  {
    value: "NO CONECTA",
    label: "No conecta",
    stateLabel: "NO CONTACTO",
    stateOrderIndex: 10,
    resultLabel: "NO CONTACTO",
    resultOrderIndex: 10,
    reasonOrderIndex: 10,
    status: "no_answer",
    outcome: "other",
    agenda: "none",
  },
  {
    value: "BUZON DE VOZ",
    label: "Buzon de voz",
    stateLabel: "NO CONTACTO",
    stateOrderIndex: 10,
    resultLabel: "NO CONTACTO",
    resultOrderIndex: 10,
    reasonOrderIndex: 20,
    status: "voicemail",
    outcome: "other",
    agenda: "none",
  },
  {
    value: "NO CONTESTA",
    label: "No contesta",
    stateLabel: "NO CONTACTO",
    stateOrderIndex: 10,
    resultLabel: "NO CONTACTO",
    resultOrderIndex: 10,
    reasonOrderIndex: 30,
    status: "no_answer",
    outcome: "other",
    agenda: "none",
  },
  {
    value: "TELEFONO FUERA DE SERVICIO",
    label: "Telefono fuera de servicio",
    stateLabel: "NO CONTACTO",
    stateOrderIndex: 10,
    resultLabel: "NO CONTACTO",
    resultOrderIndex: 10,
    reasonOrderIndex: 40,
    status: "out_of_service",
    outcome: "other",
    agenda: "none",
  },
  {
    value: "SE ENVIA INFORMACION",
    label: "Se envia informacion",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 10,
    status: "connected",
    outcome: "interested",
    agenda: "optional",
    notesRequiredWithoutAgenda: true,
  },
  {
    value: "VOLVER A LLAMAR",
    label: "Volver a llamar",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 20,
    status: "connected",
    outcome: "callback",
    agenda: "required",
  },
  {
    value: "CONTACTO CON TERCERO",
    label: "Contacto con tercero",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 25,
    status: "connected",
    outcome: "interested",
    agenda: "none",
  },
  {
    value: "REUNION AGENDADA",
    label: "Reunion agendada",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 30,
    status: "connected",
    outcome: "callback",
    agenda: "required",
  },
  {
    value: "COTIZACION ENVIADA",
    label: "Cotizacion enviada",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 40,
    status: "connected",
    outcome: "interested",
    agenda: "required",
    requiresEquifaxData: true,
  },
  {
    value: "VENTA EN VALIDACION",
    label: "Venta en validacion",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "INTERESADO",
    resultOrderIndex: 10,
    reasonOrderIndex: 50,
    status: "connected",
    outcome: "sale",
    agenda: "none",
    requiresEquifaxData: true,
  },
  {
    value: "NO CALIFICA",
    label: "No califica",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 10,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "NUMERO ERRONEO / NO CORRESPONDE",
    label: "Numero erroneo / no corresponde",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 15,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "CLIENTE CARTERIZADO",
    label: "Cliente carterizado",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 20,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "NO ENTREGA CREDITO / PAGO CONTADO",
    label: "No entrega credito / pago contado",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 30,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "CLIENTE NO SUJETO A VENTA",
    label: "Cliente no sujeto a venta",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 40,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "NO ES EL MOMENTO",
    label: "No es el momento",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 50,
    status: "connected",
    outcome: "callback",
    agenda: "required",
  },
  {
    value: "SIN PRESUPUESTO",
    label: "Sin presupuesto",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 60,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "PRECIO MUY ALTO",
    label: "Precio muy alto",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 70,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "DURACION CONTRATO",
    label: "Duracion contrato",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 80,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "TIENE CONTRATO CON LA COMPETENCIA",
    label: "Tiene contrato con la competencia",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 90,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "SE DECLARA EN QUIEBRA O PROCESO DE CIERRE",
    label: "Se declara en quiebra o proceso de cierre",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 100,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "NO DA MOTIVO",
    label: "No da motivo",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 110,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "CLIENTE MOLESTO",
    label: "Cliente molesto",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 120,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
  {
    value: "TERCERO NO ENTREGA INFORMACION",
    label: "Tercero no entrega informacion",
    stateLabel: "CONTACTO",
    stateOrderIndex: 20,
    resultLabel: "NO INTERESADO",
    resultOrderIndex: 20,
    reasonOrderIndex: 130,
    status: "connected",
    outcome: "not_interested",
    agenda: "none",
  },
] satisfies CallReasonConfig[]).sort((a, b) => {
  return (
    a.stateOrderIndex - b.stateOrderIndex ||
    a.resultOrderIndex - b.resultOrderIndex ||
    a.reasonOrderIndex - b.reasonOrderIndex ||
    a.stateLabel.localeCompare(b.stateLabel, "es") ||
    a.resultLabel.localeCompare(b.resultLabel, "es") ||
    a.label.localeCompare(b.label, "es")
  );
});

export const AGENDA_OPTIONAL_REASONS = CALL_REASONS.filter((r) => r.agenda === "optional").map((r) => r.value);
export const AGENDA_REQUIRED_REASONS = CALL_REASONS.filter((r) => r.agenda === "required").map((r) => r.value);

export function getReasonConfig(reason: string | null | undefined): CallReasonConfig | null {
  return getReasonConfigFrom(CALL_REASONS, reason);
}

export function getReasonConfigFrom(catalog: CallReasonConfig[], reason: string | null | undefined): CallReasonConfig | null {
  if (!reason) return null;
  return catalog.find((r) => r.value === reason) ?? null;
}

export function getAutoReasonForStatus(status: CallStatus): string | null {
  return CALL_REASONS.find((r) => r.status === status)?.value ?? null;
}

export function getReasonsFor(status: CallStatus, outcome: CallOutcome | null): CallReasonConfig[] {
  return CALL_REASONS.filter((r) => r.status === status && (outcome ? r.outcome === outcome : true));
}

export function getCascadeStateOptions() {
  return getCascadeStateOptionsFrom(CALL_REASONS);
}

export function getCascadeStateOptionsFrom(catalog: CallReasonConfig[]) {
  const byLabel = new Map<string, { label: string; orderIndex: number }>();
  for (const reason of catalog) {
    byLabel.set(reason.stateLabel, { label: reason.stateLabel, orderIndex: reason.stateOrderIndex });
  }
  return Array.from(byLabel.values()).sort((a, b) => a.orderIndex - b.orderIndex || a.label.localeCompare(b.label, "es"));
}

export function getCascadeResultOptions(stateLabel: string | null | undefined) {
  return getCascadeResultOptionsFrom(CALL_REASONS, stateLabel);
}

export function getCascadeResultOptionsFrom(catalog: CallReasonConfig[], stateLabel: string | null | undefined) {
  const byLabel = new Map<string, { label: string; orderIndex: number }>();
  for (const reason of catalog) {
    if (reason.stateLabel !== stateLabel) continue;
    byLabel.set(reason.resultLabel, { label: reason.resultLabel, orderIndex: reason.resultOrderIndex });
  }
  return Array.from(byLabel.values()).sort((a, b) => a.orderIndex - b.orderIndex || a.label.localeCompare(b.label, "es"));
}

export function getCascadeReasonOptions(stateLabel: string | null | undefined, resultLabel: string | null | undefined) {
  return getCascadeReasonOptionsFrom(CALL_REASONS, stateLabel, resultLabel);
}

export function getCascadeReasonOptionsFrom(
  catalog: CallReasonConfig[],
  stateLabel: string | null | undefined,
  resultLabel: string | null | undefined
) {
  return catalog.filter((r) => r.stateLabel === stateLabel && r.resultLabel === resultLabel);
}

export function resolveWorkingReason(status: CallStatus | null, reason: string | null): string {
  if (reason) return reason;
  if (status) return getAutoReasonForStatus(status) ?? FALLBACK_REASON;
  return FALLBACK_REASON;
}

export const EQUIFAX_PRODUCTS = [
  "Reporte Interactivo",
  "Mora Control",
  "Portfolio Monitor",
  "Bundle",
  "Bolsa RI",
  "Documento Unico",
  "DataFinder",
  "Malla Societaria",
  "BBDD",
] as const;

export interface CallClosurePayload {
  status: CallStatus | null;
  outcome: CallOutcome | null;
  reason: string | null;
  notes: string | null;
  next_action_at: string | null;
  equifax_products: string[];
  equifax_uf_amount: number | null;
  equifax_recipient_email: string | null;
  contact_email?: string | null;
  lead_email?: string | null;
}

/**
 * Franja en la que una campaña acepta agendas. Atlas 1 solo ofrecía bloques de
 * lunes a viernes entre 09:00 y 19:00: una agenda un domingo, a las 23:00 o en
 * el pasado queda en la cola del ejecutivo y el discador no la puede cumplir.
 * Se declara por campaña (campaigns.agenda_*, migración 20260924180100); sin
 * declaración no se restringe nada, que es como operan hoy las demás campañas.
 * La base valida lo mismo en private.agenda_fuera_de_franja.
 */
export interface AgendaPolicy {
  /** Días ISO permitidos: 1 = lunes … 7 = domingo. */
  weekdays: number[] | null;
  /** "HH:MM", inclusive. */
  from: string | null;
  /** "HH:MM", exclusivo: 19:00 es el fin de la franja, no un bloque más. */
  until: string | null;
}

export const AGENDA_TIME_ZONE = "America/Santiago";

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAY_BY_SHORT: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Convierte la fila de campaigns (PostgREST entrega `time` como "09:00:00"). */
export function readAgendaPolicy(
  row:
    | {
        agenda_dias_habiles?: number[] | null;
        agenda_hora_desde?: string | null;
        agenda_hora_hasta?: string | null;
      }
    | null
    | undefined
): AgendaPolicy | null {
  if (!row) return null;
  const weekdays =
    Array.isArray(row.agenda_dias_habiles) && row.agenda_dias_habiles.length > 0
      ? [...row.agenda_dias_habiles].map(Number).sort((a, b) => a - b)
      : null;
  const from = row.agenda_hora_desde ? row.agenda_hora_desde.slice(0, 5) : null;
  const until = row.agenda_hora_hasta ? row.agenda_hora_hasta.slice(0, 5) : null;
  if (!weekdays && !from && !until) return null;
  return { weekdays, from, until };
}

function joinSpanish(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function hoursText(policy: AgendaPolicy) {
  const parts = [
    policy.from ? `desde las ${policy.from}` : null,
    policy.until ? `antes de las ${policy.until}` : null,
  ].filter(Boolean);
  return parts.join(" y ");
}

/** Texto para el ejecutivo: «lunes, martes, … y viernes, desde las 09:00 y antes de las 19:00 (hora Chile)». */
export function describeAgendaPolicy(policy: AgendaPolicy | null): string | null {
  if (!policy) return null;
  const days = policy.weekdays ? joinSpanish(policy.weekdays.map((day) => WEEKDAY_NAMES[day - 1] ?? String(day))) : null;
  const hours = hoursText(policy);
  return `${[days, hours].filter(Boolean).join(", ")} (hora Chile)`;
}

function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function chileClock(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENDA_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    isoDay: WEEKDAY_BY_SHORT[read("weekday")] ?? 0,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

/**
 * Motivo por el que una agenda no cabe en la franja de la campaña, o null.
 * Se evalúa en hora Chile sobre el instante, no sobre la hora del navegador.
 */
export function agendaSlotError(
  nextActionAt: string | null | undefined,
  policy: AgendaPolicy | null | undefined,
  now: Date = new Date()
): string | null {
  if (!nextActionAt || !policy) return null;
  const date = new Date(nextActionAt);
  if (Number.isNaN(date.getTime())) return "Selecciona una fecha y hora de agenda válida.";
  if (date.getTime() <= now.getTime()) return "La agenda debe quedar en una fecha y hora futura.";
  const clock = chileClock(date);
  if (policy.weekdays && !policy.weekdays.includes(clock.isoDay)) {
    const days = joinSpanish(policy.weekdays.map((day) => WEEKDAY_NAMES[day - 1] ?? String(day)));
    return `La agenda debe caer en un día hábil de la campaña (${days}).`;
  }
  if (
    (policy.from && clock.minutes < minutesOf(policy.from)) ||
    (policy.until && clock.minutes >= minutesOf(policy.until))
  ) {
    return `La agenda debe quedar ${hoursText(policy)}, hora Chile.`;
  }
  return null;
}

export interface CallClosureOptions {
  /** Franja de agendas de la campaña; null o ausente no restringe. */
  agendaPolicy?: AgendaPolicy | null;
  /**
   * Agenda que ya tenía la gestión al corregirla. Si no cambia no se vuelve a
   * exigir futura: la fecha original pudo quedar atrás sin que sea un error.
   */
  previousNextActionAt?: string | null;
  now?: Date;
}

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

export interface CallAgendaPayload {
  callId: string;
  leadId: string;
  nextActionAt: string;
  notes: string | null;
}

/**
 * Contrato compartido por la UI y la acción de agenda. Mantener las notas en
 * este payload evita que el CTA confirme un guardado que sólo existió en el
 * estado local del navegador.
 */
export function buildCallAgendaPayload(input: {
  callId: string;
  leadId: string;
  nextActionAt: string;
  notes: string;
}): CallAgendaPayload {
  return {
    callId: input.callId,
    leadId: input.leadId,
    nextActionAt: input.nextActionAt,
    notes: input.notes.trim() ? input.notes : null,
  };
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value: string | null | undefined) {
  return normalizeText(value).replace(/[^A-Z0-9]+/g, " ").trim();
}

function displayStateLabel(value: string) {
  const normalized = normalizeKey(value);
  if (normalized === "CONTACTO" || normalized === "NO CONTACTO") return normalized;
  // "NO CONECTA" contiene la palabra "CONECTA". Resolver primero la
  // negación evita colapsar ambas ramas del workflow bajo CONTACTO.
  if (normalized.includes("NO CONECT") || normalized.includes("NO CONTACT")) return "NO CONTACTO";
  if (normalized.includes("CONECT")) return "CONTACTO";
  return "NO CONTACTO";
}

function displayResultLabel(stateLabel: string, value: string) {
  const normalized = normalizeKey(value);
  if (stateLabel === "NO CONTACTO") return "NO CONTACTO";
  if (normalized === "INTERESADO" || normalized === "NO INTERESADO") return normalized;
  if (normalized.includes("NO INTERES")) return "NO INTERESADO";
  if (affirmsSale(normalized) || normalized.includes("FUTURO") || normalized.includes("CALLBACK")) return "INTERESADO";
  return normalized || "GESTION";
}

function inferStatus(label: string): CallStatus {
  const normalized = normalizeKey(label);
  // Alguien contestó aunque no fuera el titular: para contactabilidad la línea
  // conectó, y el catálogo del producto ya trata así ambos casos.
  if (
    normalized.includes("CON TERCERO") ||
    normalized.includes("NUMERO ERRONEO") ||
    normalized.includes("NUMERO EQUIVOCADO") ||
    normalized.includes("NO CORRESPONDE")
  ) {
    return "connected";
  }
  if (normalized.includes("BUZON")) return "voicemail";
  if (normalized.includes("OCUP")) return "busy";
  // "SERVICIO" a secas no es una línea caída: "Contrata servicio" o "Ya tiene
  // el servicio" son contactos efectivos.
  if (normalized.includes("FUERA") || normalized.includes("SIN SERVICIO")) return "out_of_service";
  if (normalized.includes("NO CONTESTA") || normalized.includes("NO CONECTA") || normalized.includes("NO CONTACTO")) return "no_answer";
  return "connected";
}

/**
 * Cierres de cobranza. Van antes que la lectura comercial porque son frases
 * completas y propias del ciclo de cartera ("convenio suscrito", "compromiso de
 * pago"): ningún catálogo de venta las contiene, así que no cambian el
 * comportamiento de los workflows existentes.
 */
function inferCollectionsOutcome(text: string): CallOutcome | null {
  if (
    text.includes("CONVENIO SUSCRITO") ||
    text.includes("PAGO YA REALIZADO") ||
    text.includes("PAGO CONFIRMADO") ||
    text.includes("PAGO TOTAL")
  ) {
    // Es la plata que entra: el equivalente de la venta en una cartera.
    return "sale";
  }
  if (text.includes("COMPROMISO DE PAGO") || text.includes("NEGOCIACION EN CURSO")) {
    // Promesa con fecha: la gestión sigue viva y necesita agenda.
    return "callback";
  }
  if (text.includes("SIN CAPACIDAD DE PAGO") || text.includes("RECHAZA LA DEUDA")) return "not_interested";
  if (text.includes("RECLAMO A LA FUNDACION") || text.includes("ALUMNO RETIRADO")) return "not_interested";
  if (text.includes("COBRANZA PREJUDICIAL") || text.includes("SEGUIMIENTO DE CONVENIO")) return "other";
  return null;
}

/**
 * «VENTA» afirmada, no negada. «CLIENTE NO SUJETO A VENTA» contiene la palabra
 * y se grababa como venta: la ficha le exigía datos Equifax y el cierre lo
 * rechazaba por no ser VENTA EN VALIDACION. Una negación (NO o SIN) hasta tres
 * palabras antes anula la mención, y lo que declara falta de interés nunca es
 * venta, venga en el resultado o en el motivo.
 */
function affirmsSale(text: string) {
  if (text.includes("NO INTERES")) return false;
  const withoutNegations = text.replace(/\b(?:NO|SIN)\s+(?:[A-Z0-9]+\s+){0,3}?VENTAS?\b/g, " ");
  return withoutNegations.includes("VENTA");
}

function inferOutcome(stateLabel: string, resultLabel: string, reason: string): CallOutcome {
  const text = normalizeKey(`${stateLabel} ${resultLabel} ${reason}`);
  if (stateLabel === "NO CONTACTO") return "other";
  const collections = inferCollectionsOutcome(text);
  if (collections) return collections;
  if (affirmsSale(text)) return "sale";
  if (text.includes("VOLVER") || text.includes("REUNION") || text.includes("AGEND") || text.includes("MOMENTO")) return "callback";
  if (resultLabel === "NO INTERESADO") return "not_interested";
  if (resultLabel === "INTERESADO") return "interested";
  return "other";
}

/** Espejo de private.assert_management_closure_rules (20260924180100). */
function sendsInformation(reason: string) {
  const normalized = normalizeKey(reason);
  return normalized.includes("ENVIA INFORMACION") || normalized.includes("ENVIAR INFORMACION");
}

function inferAgenda(reason: string, requiresEquifaxData: boolean): AgendaRequirement {
  const normalized = normalizeKey(reason);
  if (
    normalized.includes("VOLVER A LLAMAR") ||
    normalized.includes("REUNION") ||
    normalized.includes("NO ES EL MOMENTO") ||
    // Un compromiso sin fecha no es un compromiso: en cobranza la agenda es
    // parte del acuerdo, no un recordatorio del ejecutivo.
    normalized.includes("COMPROMISO DE PAGO") ||
    normalized.includes("NEGOCIACION EN CURSO") ||
    (requiresEquifaxData && normalized.includes("COTIZACION"))
  ) {
    return "required";
  }
  // Fuera del contrato Equifax una cotizacion admite seguimiento pero no lo
  // exige: el cierre pasa con o sin fecha. Enviar informacion es lo mismo: el
  // cliente pide el material y hay que volver a llamarlo para saber si lo leyo;
  // sin fecha el registro se cerraba y desaparecia de la agenda del ejecutivo.
  // La regla espejo vive en public.management_agenda_requirement (migraciones
  // 20260910190000 y 20260923170000) y es la unica que valida la base, para
  // que UI y persistencia no puedan divergir.
  if (
    normalized.includes("COTIZACION") ||
    normalized.includes("ENVIAR INFORMACION") ||
    normalized.includes("ENVIA INFORMACION")
  ) {
    return "optional";
  }
  return "none";
}

function titleToReason(step: WorkflowStep, fallback: string) {
  const text = normalizeKey(`${step.name} ${step.description ?? ""}`);
  const known = CALL_REASONS.find((reason) => text.includes(normalizeKey(reason.value)));
  if (known) return known.value;
  if (affirmsSale(text)) return "VENTA EN VALIDACION";
  if (text.includes("FUERA") || text.includes("SIN SERVICIO")) return "TELEFONO FUERA DE SERVICIO";
  if (text.includes("BUZON")) return "BUZON DE VOZ";
  if (text.includes("NO CONTESTA")) return "NO CONTESTA";
  return normalizeText(fallback || step.name);
}

function stepOptions(step: WorkflowStep | null | undefined) {
  if (!step) return [];
  if (Array.isArray(step.options) && step.options.length > 0) return step.options;
  if (Array.isArray(step.allowed_results) && step.allowed_results.length > 0) return step.allowed_results;
  return [];
}

/**
 * Paso donde empieza la cascada. `is_start` lo marca un administrador en el
 * lienzo y puede terminar en un nodo intermedio: el 2026-09-11 Secretaria
 * Virtual quedó empezando en «Conecta», sus opciones se leyeron como estados,
 * todo contacto se grabó como NO CONTACTO y desaparecieron «No contesta» y
 * «Buzón de voz». Un paso al que llega una rama nunca es el comienzo; si el
 * marcado apunta a uno así y hay una única raíz con salidas, manda la raíz.
 */
function resolveStartStep(steps: WorkflowStep[], branches: WorkflowStepBranch[]) {
  const marked = steps.find((step) => step.is_start);
  const incoming = new Set(branches.map((branch) => branch.to_step_id).filter(Boolean));
  if (marked && !incoming.has(marked.id)) return marked;

  const roots = steps.filter(
    (step) =>
      !incoming.has(step.id) &&
      stepOptions(step).length > 0 &&
      branches.some((branch) => branch.from_step_id === step.id)
  );
  if (roots.length === 1) return roots[0];
  return marked ?? steps[0];
}

function branchTarget(
  branches: WorkflowStepBranch[],
  fromStepId: string,
  fromOption: string | null
) {
  return (
    branches.find((branch) => branch.from_step_id === fromStepId && branch.from_option === fromOption)?.to_step_id ??
    branches.find((branch) => branch.from_step_id === fromStepId && branch.from_option === null)?.to_step_id ??
    null
  );
}

export function buildCallReasonCatalogFromWorkflow(
  steps: WorkflowStep[] | null | undefined,
  branches: WorkflowStepBranch[] | null | undefined
): CallReasonConfig[] {
  const workflowSteps = steps ?? [];
  const workflowBranches = branches ?? [];
  const workflowRequiresEquifaxData = workflowSteps.some((step) =>
    normalizeKey(`${step.name} ${step.description ?? ""}`).includes("EQUIFAX")
  );
  const startStep = resolveStartStep(workflowSteps, workflowBranches);
  const startOptions = stepOptions(startStep);
  if (!startStep || startOptions.length === 0) return [];

  const stepById = new Map(workflowSteps.map((step) => [step.id, step]));
  const catalog: CallReasonConfig[] = [];

  function pushReason(input: {
    stateLabel: string;
    stateOrderIndex: number;
    resultLabel: string;
    resultOrderIndex: number;
    reasonLabel: string;
    reasonOrderIndex: number;
    groupPath: string[];
  }) {
    const value = normalizeText(input.reasonLabel);
    if (!value) return;
    const status = inferStatus(`${input.stateLabel} ${input.reasonLabel}`);
    const outcome = inferOutcome(input.stateLabel, input.resultLabel, input.reasonLabel);
    const requiresEquifaxData =
      workflowRequiresEquifaxData &&
      (value === "COTIZACION ENVIADA" || outcome === "sale");
    const agenda = inferAgenda(input.reasonLabel, requiresEquifaxData);
    catalog.push({
      value,
      label: input.reasonLabel,
      status,
      outcome,
      agenda,
      requiresEquifaxData,
      notesRequiredWithoutAgenda: workflowRequiresEquifaxData && agenda === "optional" && sendsInformation(value),
      stateLabel: input.stateLabel,
      stateOrderIndex: input.stateOrderIndex,
      resultLabel: input.resultLabel,
      resultOrderIndex: input.resultOrderIndex,
      reasonOrderIndex: input.reasonOrderIndex,
      groupPath: input.groupPath,
    });
  }

  startOptions.forEach((stateOption, stateIndex) => {
    const stateTargetId = branchTarget(workflowBranches, startStep.id, stateOption);
    const stateTarget = stateTargetId ? stepById.get(stateTargetId) ?? null : null;
    const stateLabel = displayStateLabel(stateOption);
    const stateOrderIndex = stateIndex * 10 + 10;
    const targetOptions = stepOptions(stateTarget);

    if (!stateTarget || targetOptions.length === 0) {
      pushReason({
        stateLabel,
        stateOrderIndex,
        resultLabel: displayResultLabel(stateLabel, stateOption),
        resultOrderIndex: 10,
        reasonLabel: stateTarget ? titleToReason(stateTarget, stateOption) : stateOption,
        reasonOrderIndex: 10,
        groupPath: [],
      });
      return;
    }

    targetOptions.forEach((resultOption, resultIndex) => {
      const resultLabel = displayResultLabel(stateLabel, resultOption);
      const resultOrderIndex = resultIndex * 10 + 10;
      let reasonOrderIndex = 0;

      // Recorre la rama completa, sin límite de niveles. Antes se leían solo
      // tres (estado, resultado, motivo): una opción con paso propio se
      // reemplazaba por sus hijas sin dejar rastro —así desapareció «No
      // Interesa» de Secretaria Virtual el 2026-09-11— y lo que colgaba de un
      // cuarto nivel se descartaba. Cada opción intermedia viaja ahora en
      // `groupPath` y la ficha la dibuja como grupo.
      const visit = (fromStep: WorkflowStep, option: string, groupPath: string[], seen: Set<string>) => {
        const targetId = branchTarget(workflowBranches, fromStep.id, option);
        const target = targetId ? stepById.get(targetId) ?? null : null;
        const children = stepOptions(target);
        if (target && children.length > 0 && !seen.has(target.id)) {
          const nextSeen = new Set(seen).add(target.id);
          children.forEach((child) => visit(target, child, [...groupPath, option], nextSeen));
          return;
        }
        reasonOrderIndex += 10;
        pushReason({
          stateLabel,
          stateOrderIndex,
          resultLabel,
          resultOrderIndex,
          // Una rama que vuelve a un paso ya recorrido se corta en la opción
          // que cierra el ciclo; la validación del editor lo advierte.
          reasonLabel: target && children.length === 0 ? titleToReason(target, option) : option,
          reasonOrderIndex,
          groupPath,
        });
      };

      visit(stateTarget, resultOption, [], new Set([startStep.id, stateTarget.id]));
    });
  });

  const byValue = new Map<string, CallReasonConfig>();
  for (const reason of catalog) {
    const group = (reason.groupPath ?? []).join(">");
    byValue.set(`${reason.stateLabel}|${reason.resultLabel}|${group}|${reason.value}`, reason);
  }

  return Array.from(byValue.values()).sort((a, b) => {
    return (
      a.stateOrderIndex - b.stateOrderIndex ||
      a.resultOrderIndex - b.resultOrderIndex ||
      a.reasonOrderIndex - b.reasonOrderIndex ||
      a.value.localeCompare(b.value, "es")
    );
  });
}

/** Motivos agrupados por estado (CONTACTO / NO CONTACTO), en el orden del flujo. */
export function groupReasonsByState(catalog: CallReasonConfig[]) {
  const states = new Map<string, { label: string; orderIndex: number; reasons: CallReasonConfig[] }>();
  for (const option of catalog) {
    const state = states.get(option.stateLabel) ?? {
      label: option.stateLabel,
      orderIndex: option.stateOrderIndex,
      reasons: [],
    };
    state.reasons.push(option);
    states.set(option.stateLabel, state);
  }

  return Array.from(states.values())
    .sort((a, b) => a.orderIndex - b.orderIndex || a.label.localeCompare(b.label, "es"))
    .map((state) => ({
      ...state,
      reasons: [...state.reasons].sort(
        (a, b) =>
          a.resultOrderIndex - b.resultOrderIndex ||
          a.reasonOrderIndex - b.reasonOrderIndex ||
          a.label.localeCompare(b.label, "es")
      ),
    }));
}

export type ReasonOptionNode =
  | { kind: "reason"; option: CallReasonConfig }
  | { kind: "group"; label: string; children: ReasonOptionNode[] };

/**
 * Anida los motivos de un estado según su `groupPath`, sin alterar el orden.
 * La ficha del ejecutivo y la vista previa del editor dibujan este mismo
 * árbol, así que lo que ve el administrador es lo que se tipifica.
 */
export function nestReasonOptions(reasons: CallReasonConfig[]): ReasonOptionNode[] {
  const root: ReasonOptionNode[] = [];
  for (const reason of reasons) {
    let level = root;
    for (const label of reason.groupPath ?? []) {
      const last = level[level.length - 1];
      if (last?.kind === "group" && last.label === label) {
        level = last.children;
      } else {
        const group = { kind: "group" as const, label, children: [] as ReasonOptionNode[] };
        level.push(group);
        level = group.children;
      }
    }
    level.push({ kind: "reason", option: reason });
  }
  return root;
}

export function validateCallClosure(
  payload: CallClosurePayload,
  catalog: CallReasonConfig[] = CALL_REASONS,
  options: CallClosureOptions = {}
): string[] {
  const errors: string[] = [];

  if (!payload.status || !payload.reason) {
    errors.push("Selecciona una tipificacion antes de cerrar.");
    return errors;
  }

  const reasonConfig = getReasonConfigFrom(catalog, payload.reason);
  if (!reasonConfig) {
    errors.push("La tipificacion seleccionada no pertenece al flujo de la campaña.");
    return errors;
  }

  if (reasonConfig.status !== payload.status) {
    errors.push("El estado no coincide con el motivo seleccionado.");
  }
  if (!payload.outcome || reasonConfig.outcome !== payload.outcome) {
    errors.push("El resultado no coincide con el motivo seleccionado.");
  }

  const hasAgenda = Boolean(payload.next_action_at);

  if (reasonConfig.agenda === "required" && !hasAgenda) {
    errors.push("Esta tipificacion requiere fecha y hora de agenda.");
  }
  if (reasonConfig.agenda === "none" && hasAgenda) {
    errors.push("Esta tipificacion no admite una agenda.");
  }
  // "optional" no valida nada: la agenda es una decision del ejecutivo y el
  // cierre nunca se bloquea por ella.

  if (hasAgenda && reasonConfig.agenda !== "none" && !sameInstant(payload.next_action_at, options.previousNextActionAt)) {
    const slotError = agendaSlotError(payload.next_action_at, options.agendaPolicy, options.now);
    if (slotError) errors.push(slotError);
  }

  if (reasonConfig.notesRequiredWithoutAgenda && !hasAgenda && !payload.notes?.trim()) {
    errors.push(`Sin agenda, ${reasonConfig.value} exige una nota con lo enviado.`);
  }

  if (payload.outcome === "sale" && payload.reason !== "VENTA EN VALIDACION") {
    errors.push("Para registrar venta usa la tipificacion VENTA EN VALIDACION.");
  }

  const requiresProductAndUf = reasonConfig.requiresEquifaxData === true;
  if (requiresProductAndUf && payload.equifax_products.length === 0) {
    errors.push("Selecciona al menos un producto Equifax.");
  }
  if (requiresProductAndUf && (payload.equifax_uf_amount === null || payload.equifax_uf_amount === undefined)) {
    errors.push("Ingresa la UF mensual de la oportunidad.");
  }

  if (reasonConfig.requiresEquifaxData && payload.reason === "COTIZACION ENVIADA") {
    const email = payload.equifax_recipient_email || payload.contact_email || payload.lead_email;
    if (!email) {
      errors.push("Indica un email destinatario para la cotizacion.");
    }
  }

  return errors;
}
