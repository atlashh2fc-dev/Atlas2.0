export const AGENT_FORCE_LOGOUT_EVENT = "atlas:agent-force-logout";

export type AgentForceLogoutEventDetail = {
  commandId: string;
  shutdowns: Promise<unknown>[];
};

/**
 * El teléfono vive en el layout del dashboard, así que cualquier pantalla que
 * quiera originar una llamada (hoy "Mi agenda" y la ficha del cliente) se lo
 * pide por evento en vez de duplicar la lógica SIP.
 */
export const AGENT_DIAL_REQUEST_EVENT = "atlas:agent-dial-request";

/** La ficha avisa al CTI que una gestion termino para refrescar su modo. */
export const AGENT_MANAGEMENT_CLOSED_EVENT = "atlas:agent-management-closed";

export function notifyAgentManagementClosed() {
  window.dispatchEvent(new Event(AGENT_MANAGEMENT_CLOSED_EVENT));
}

/**
 * La ficha pide cortar la llamada en curso ("Colgar y cerrar") al mismo
 * teléfono del layout, que es el único dueño de la sesión SIP.
 */
export const AGENT_HANGUP_REQUEST_EVENT = "atlas:agent-hangup-request";

export function requestAgentHangup() {
  window.dispatchEvent(new Event(AGENT_HANGUP_REQUEST_EVENT));
}

export type AgentDialRequestEventDetail = {
  leadId: string;
  source?: "agenda" | "assigned_lead";
  /** Solo para feedback inmediato en el CTI: el teléfono real lo resuelve el servidor. */
  fullName?: string | null;
  /** Número elegido entre los de la ficha; sin él se marca el principal. */
  phone?: string | null;
};

export function requestAgentDial(detail: AgentDialRequestEventDetail) {
  window.dispatchEvent(
    new CustomEvent<AgentDialRequestEventDetail>(AGENT_DIAL_REQUEST_EVENT, { detail })
  );
}
