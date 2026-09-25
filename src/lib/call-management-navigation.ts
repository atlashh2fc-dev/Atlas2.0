export type CallManagementNavigation =
  | { kind: "refresh" }
  | { kind: "push"; href: string };

export type ManualCallEndState =
  | "answered"
  | "not_answered"
  | "origination_failed";

export type ManualCallManagementAction = "open_typification" | "discard";

/**
 * Una gestión puede abrirse mientras el ejecutivo ya está en la ficha del
 * mismo lead. Hacer push a esa misma URL y refrescar inmediatamente crea una
 * carrera en el App Router: el refresh puede resolver la vista previa a la
 * creación de la llamada y dejar el formulario de tipificación fuera.
 */
export function resolveCallManagementNavigation(
  currentPathname: string,
  leadId: string
): CallManagementNavigation {
  const leadPath = `/dashboard/leads/${encodeURIComponent(leadId)}`;
  return currentPathname === leadPath
    ? { kind: "refresh" }
    : { kind: "push", href: `${leadPath}?tipificar=1` };
}

/**
 * Una llamada que alcanzó a originarse siempre requiere cierre humano, aunque
 * el cliente no haya contestado. Sólo un fallo técnico previo a la originación
 * puede eliminar la gestión automáticamente.
 */
export function resolveManualCallManagementAction(
  endState: ManualCallEndState
): ManualCallManagementAction {
  return endState === "origination_failed" ? "discard" : "open_typification";
}

/**
 * Mensajes con que la base rechaza marcar o corregir mientras otra gestión
 * del ejecutivo sigue abierta (ver begin_agent_* y revise_call_management).
 */
const PENDING_MANAGEMENT_ERROR = /pendiente de tipificaci|llamada activa antes de corregir|llamada o tipificaci[oó]n en curso/i;

export function isPendingManagementError(message: string | null | undefined): boolean {
  return PENDING_MANAGEMENT_ERROR.test(message ?? "");
}

/** Canal de una gestión sin llamada, como lo ve el ejecutivo. */
export const OFFLINE_CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  correo: "Correo",
  presencial: "Presencial",
  otro: "Otro canal",
};
