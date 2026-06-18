// Cascada de tipificación de llamadas: Estado -> Resultado -> Motivo.
//
// NOTA IMPORTANTE: esta cascada se construyó a partir de un spec que solo
// detalla 9 motivos de negocio + 1 fallback. Si en el futuro aparecen más
// estados/resultados/motivos, agrégalos a CALL_REASONS siguiendo el mismo
// patrón — no inventes reglas nuevas sin confirmar con el spec/negocio.

export type CallStatus = "connected" | "out_of_service" | "no_answer";

// TODO: el spec solo define reglas para outcome "sale" y "callback". Si
// aparecen más resultados (ej. "no_sale", "not_interested"), súmalos aquí
// y crea sus motivos en CALL_REASONS.
export type CallOutcome = "sale" | "callback";

export type AgendaRequirement = "required" | "optional" | "none";

export interface CallReasonConfig {
  /** Valor exacto que se persiste en calls.reason / leads.tipificacion_actual */
  value: string;
  label: string;
  status: CallStatus;
  /** null cuando el motivo se asigna automáticamente por status (no pasa por resultado) */
  outcome: CallOutcome | null;
  agenda: AgendaRequirement;
  /** true = motivo fijo asignado automáticamente al status, no aparece en la cascada manual */
  isAutoReason?: boolean;
}

export const CALL_STATUSES: { value: CallStatus; label: string }[] = [
  { value: "connected", label: "Contactado" },
  { value: "out_of_service", label: "Fuera de servicio" },
  { value: "no_answer", label: "No contesta" },
];

export const CALL_OUTCOMES_BY_STATUS: Record<CallStatus, { value: CallOutcome; label: string }[]> = {
  connected: [
    { value: "callback", label: "Seguimiento / Próximo contacto" },
    { value: "sale", label: "Venta" },
  ],
  out_of_service: [],
  no_answer: [],
};

/** Motivo usado como placeholder mientras no hay un motivo final seleccionado desde la cascada. */
export const FALLBACK_REASON = "GESTION EN CURSO";

export const CALL_REASONS: CallReasonConfig[] = [
  // Motivos automáticos por estado (no requieren pasar por la cascada de resultado)
  { value: "FUERA DE SERVICIO", label: "Fuera de servicio", status: "out_of_service", outcome: null, agenda: "none", isAutoReason: true },
  { value: "NO CONTESTA", label: "No contesta", status: "no_answer", outcome: null, agenda: "none", isAutoReason: true },

  // Motivos de la cascada manual (status = connected)
  { value: "REUNION AGENDADA", label: "Reunión agendada", status: "connected", outcome: "callback", agenda: "required" },
  { value: "COTIZACION ENVIADA", label: "Cotización enviada", status: "connected", outcome: "callback", agenda: "required" },
  { value: "NO ES EL MOMENTO", label: "No es el momento", status: "connected", outcome: "callback", agenda: "required" },
  { value: "VOLVER A LLAMAR", label: "Volver a llamar", status: "connected", outcome: "callback", agenda: "optional" },
  { value: "SE ENVIA INFORMACION", label: "Se envía información", status: "connected", outcome: "callback", agenda: "optional" },
  { value: "INFORMACION ENVIADA", label: "Información enviada", status: "connected", outcome: "callback", agenda: "optional" },
  { value: "VENTA EN VALIDACION", label: "Venta en validación", status: "connected", outcome: "sale", agenda: "none" },
];

export const AGENDA_OPTIONAL_REASONS = CALL_REASONS.filter((r) => r.agenda === "optional").map((r) => r.value);
export const AGENDA_REQUIRED_REASONS = CALL_REASONS.filter((r) => r.agenda === "required").map((r) => r.value);

export function getAutoReasonForStatus(status: CallStatus): string | null {
  return CALL_REASONS.find((r) => r.status === status && r.isAutoReason)?.value ?? null;
}

export function getReasonConfig(reason: string | null | undefined): CallReasonConfig | null {
  if (!reason) return null;
  return CALL_REASONS.find((r) => r.value === reason) ?? null;
}

/** Motivos seleccionables manualmente desde la cascada para un status/outcome dado. */
export function getReasonsFor(status: CallStatus, outcome: CallOutcome | null): CallReasonConfig[] {
  return CALL_REASONS.filter((r) => r.status === status && !r.isAutoReason && (outcome ? r.outcome === outcome : true));
}

/** Motivo a mostrar/persistir mientras la gestión está en curso (no es válido para cerrar). */
export function resolveWorkingReason(status: CallStatus | null, reason: string | null): string {
  if (reason) return reason;
  if (status) {
    const auto = getAutoReasonForStatus(status);
    if (auto) return auto;
  }
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
 * Valida los campos obligatorios, la agenda y las reglas comerciales Equifax
 * antes de permitir el cierre ("Guardar y terminar"). Devuelve la lista de
 * errores; vacía = se puede cerrar.
 */
export function validateCallClosure(payload: CallClosurePayload): string[] {
  const errors: string[] = [];

  if (!payload.status) {
    errors.push("Debes seleccionar un estado para la llamada.");
    return errors;
  }

  const reasonConfig = getReasonConfig(payload.reason);

  if (payload.status === "connected") {
    // En el flujo normal siempre debe existir un motivo final seleccionado desde la cascada.
    if (!payload.reason || !reasonConfig || reasonConfig.isAutoReason) {
      errors.push("Debes seleccionar un motivo desde la cascada Estado → Resultado → Motivo antes de cerrar.");
      return errors;
    }
    if (!payload.outcome || reasonConfig.outcome !== payload.outcome) {
      errors.push("El resultado seleccionado no coincide con el motivo elegido.");
    }
  } else if (payload.reason && reasonConfig && reasonConfig.status !== payload.status) {
    errors.push("El motivo seleccionado no corresponde al estado de la llamada.");
  }

  const agendaReq: AgendaRequirement = reasonConfig?.agenda ?? "none";
  const hasAgenda = Boolean(payload.next_action_at);
  const hasNotes = Boolean(payload.notes && payload.notes.trim().length > 0);

  if (agendaReq === "required" && !hasAgenda) {
    errors.push("Debes seleccionar fecha y hora de agenda antes de cerrar esta tipificación.");
  }
  if (agendaReq === "optional" && !hasAgenda && !hasNotes) {
    errors.push("Si no agendas fecha/hora, debes dejar una observación con el próximo paso antes de cerrar.");
  }

  // Validaciones comerciales Equifax (solo aplican cuando status = connected)
  if (payload.status === "connected") {
    if (payload.outcome === "sale" && payload.reason !== "VENTA EN VALIDACION") {
      errors.push("Para registrar outcome de venta, el motivo debe ser exactamente \"VENTA EN VALIDACION\".");
    }

    const requiresProductAndUf = payload.reason === "COTIZACION ENVIADA" || payload.outcome === "sale";
    if (requiresProductAndUf && payload.equifax_products.length === 0) {
      errors.push("Debes seleccionar al menos un producto Equifax.");
    }
    if (requiresProductAndUf && (payload.equifax_uf_amount === null || payload.equifax_uf_amount === undefined)) {
      errors.push("Debes ingresar la UF mensual de la oportunidad.");
    }

    if (payload.reason === "COTIZACION ENVIADA") {
      const email = payload.equifax_recipient_email || payload.contact_email || payload.lead_email;
      if (!email) {
        errors.push("Debes indicar un email destinatario para la cotización (contacto, lead, complementario o de la oportunidad).");
      }
    }
  }

  return errors;
}
