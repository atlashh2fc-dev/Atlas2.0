import { logger } from "../logger";
import { expireStaleAgentHeartbeats } from "../supabaseClient";

/**
 * Corre cada ciclo (ver AGENT_HEARTBEAT_CHECK_MS en server.ts) y fuerza
 * 'desconectado' a cualquier agente cuyo heartbeat se venció — cierre
 * abrupto de pestaña/navegador que markAgentLoggedOut() (CRM) no alcanza a
 * cubrir porque nunca pasa por signOut().
 */
export async function checkAgentHeartbeats(): Promise<void> {
  try {
    const expired = await expireStaleAgentHeartbeats();
    if (expired.length > 0) {
      logger.warn(
        { profileIds: expired },
        "Agente(s) desconectado(s) por heartbeat vencido (cierre abrupto de pestaña/navegador)"
      );
    }
  } catch (err) {
    logger.error({ err }, "No se pudo revisar heartbeats de agentes");
  }
}
