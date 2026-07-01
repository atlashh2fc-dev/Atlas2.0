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
    agenda: "none",
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
  if (normalized.includes("CONECT")) return "CONTACTO";
  return "NO CONTACTO";
}

function displayResultLabel(stateLabel: string, value: string) {
  const normalized = normalizeKey(value);
  if (stateLabel === "NO CONTACTO") return "NO CONTACTO";
  if (normalized === "INTERESADO" || normalized === "NO INTERESADO") return normalized;
  if (normalized.includes("NO INTERES")) return "NO INTERESADO";
  if (normalized.includes("VENTA") || normalized.includes("FUTURO") || normalized.includes("CALLBACK")) return "INTERESADO";
  return normalized || "GESTION";
}

function inferStatus(label: string): CallStatus {
  const normalized = normalizeKey(label);
  if (normalized.includes("BUZON")) return "voicemail";
  if (normalized.includes("OCUP")) return "busy";
  if (normalized.includes("FUERA") || normalized.includes("SERVICIO")) return "out_of_service";
  if (normalized.includes("NO CONTESTA") || normalized.includes("NO CONECTA") || normalized.includes("NO CONTACTO")) return "no_answer";
  return "connected";
}

function inferOutcome(stateLabel: string, resultLabel: string, reason: string): CallOutcome {
  const text = normalizeKey(`${stateLabel} ${resultLabel} ${reason}`);
  if (stateLabel === "NO CONTACTO") return "other";
  if (text.includes("VENTA")) return "sale";
  if (text.includes("VOLVER") || text.includes("REUNION") || text.includes("AGEND") || text.includes("MOMENTO")) return "callback";
  if (resultLabel === "NO INTERESADO") return "not_interested";
  if (resultLabel === "INTERESADO") return "interested";
  return "other";
}

function inferAgenda(reason: string): AgendaRequirement {
  const normalized = normalizeKey(reason);
  if (
    normalized.includes("VOLVER A LLAMAR") ||
    normalized.includes("REUNION") ||
    normalized.includes("COTIZACION") ||
    normalized.includes("NO ES EL MOMENTO")
  ) {
    return "required";
  }
  return "none";
}

function titleToReason(step: WorkflowStep, fallback: string) {
  const text = normalizeKey(`${step.name} ${step.description ?? ""}`);
  const known = CALL_REASONS.find((reason) => text.includes(normalizeKey(reason.value)));
  if (known) return known.value;
  if (text.includes("VENTA")) return "VENTA EN VALIDACION";
  if (text.includes("FUERA") || text.includes("SERVICIO")) return "TELEFONO FUERA DE SERVICIO";
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
  const startStep = workflowSteps.find((step) => step.is_start) ?? workflowSteps[0];
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
  }) {
    const value = normalizeText(input.reasonLabel);
    if (!value) return;
    const status = inferStatus(`${input.stateLabel} ${input.reasonLabel}`);
    const outcome = inferOutcome(input.stateLabel, input.resultLabel, input.reasonLabel);
    catalog.push({
      value,
      label: input.reasonLabel,
      status,
      outcome,
      agenda: inferAgenda(input.reasonLabel),
      stateLabel: input.stateLabel,
      stateOrderIndex: input.stateOrderIndex,
      resultLabel: input.resultLabel,
      resultOrderIndex: input.resultOrderIndex,
      reasonOrderIndex: input.reasonOrderIndex,
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
      });
      return;
    }

    targetOptions.forEach((resultOption, resultIndex) => {
      const resultTargetId = branchTarget(workflowBranches, stateTarget.id, resultOption);
      const resultTarget = resultTargetId ? stepById.get(resultTargetId) ?? null : null;
      const resultLabel = displayResultLabel(stateLabel, resultOption);
      const resultOrderIndex = resultIndex * 10 + 10;
      const reasonOptions = stepOptions(resultTarget);

      if (resultTarget && reasonOptions.length > 0) {
        reasonOptions.forEach((reasonOption, reasonIndex) => {
          pushReason({
            stateLabel,
            stateOrderIndex,
            resultLabel,
            resultOrderIndex,
            reasonLabel: reasonOption,
            reasonOrderIndex: reasonIndex * 10 + 10,
          });
        });
        return;
      }

      pushReason({
        stateLabel,
        stateOrderIndex,
        resultLabel,
        resultOrderIndex,
        reasonLabel: resultTarget ? titleToReason(resultTarget, resultOption) : resultOption,
        reasonOrderIndex: 10,
      });
    });
  });

  const byValue = new Map<string, CallReasonConfig>();
  for (const reason of catalog) {
    byValue.set(`${reason.stateLabel}|${reason.resultLabel}|${reason.value}`, reason);
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

export function validateCallClosure(payload: CallClosurePayload, catalog: CallReasonConfig[] = CALL_REASONS): string[] {
  const errors: string[] = [];

  if (!payload.status || !payload.reason) {
    errors.push("Selecciona una tipificacion antes de cerrar.");
    return errors;
  }

  const reasonConfig = getReasonConfigFrom(catalog, payload.reason);
  if (!reasonConfig) {
    errors.push("La tipificacion seleccionada no pertenece al flujo Equifax.");
    return errors;
  }

  if (reasonConfig.status !== payload.status) {
    errors.push("El estado no coincide con el motivo seleccionado.");
  }
  if (!payload.outcome || reasonConfig.outcome !== payload.outcome) {
    errors.push("El resultado no coincide con el motivo seleccionado.");
  }

  const hasAgenda = Boolean(payload.next_action_at);
  const hasNotes = Boolean(payload.notes && payload.notes.trim().length > 0);

  if (reasonConfig.agenda === "required" && !hasAgenda) {
    errors.push("Esta tipificacion requiere fecha y hora de agenda.");
  }
  if (reasonConfig.agenda === "optional" && !hasAgenda && !hasNotes) {
    errors.push("Si no agendas fecha/hora, deja una observacion con el proximo paso.");
  }

  if (payload.outcome === "sale" && payload.reason !== "VENTA EN VALIDACION") {
    errors.push("Para registrar venta usa la tipificacion VENTA EN VALIDACION.");
  }

  const requiresProductAndUf = payload.reason === "COTIZACION ENVIADA" || payload.outcome === "sale";
  if (requiresProductAndUf && payload.equifax_products.length === 0) {
    errors.push("Selecciona al menos un producto Equifax.");
  }
  if (requiresProductAndUf && (payload.equifax_uf_amount === null || payload.equifax_uf_amount === undefined)) {
    errors.push("Ingresa la UF mensual de la oportunidad.");
  }

  if (payload.reason === "COTIZACION ENVIADA") {
    const email = payload.equifax_recipient_email || payload.contact_email || payload.lead_email;
    if (!email) {
      errors.push("Indica un email destinatario para la cotizacion.");
    }
  }

  return errors;
}
