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
