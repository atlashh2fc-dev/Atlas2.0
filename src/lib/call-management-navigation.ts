export type CallManagementNavigation =
  | { kind: "refresh" }
  | { kind: "push"; href: string };

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
