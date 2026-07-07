import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { getAgentPauseStates } from "../supabaseClient";
import { amiAction } from "../asterisk/configSync";

/**
 * Sincroniza el estado de pausa del agente (Disponible/Auxiliar/Baño/
 * Capacitación, elegido desde la barra CTI) hacia Asterisk via AMI
 * QueuePause. No se especifica Queue en la acción: Asterisk pausa/despausa
 * al Interface en TODAS las colas de las que sea miembro, así no hace falta
 * saber a qué campañas está asignado el agente en este módulo.
 *
 * Solo actúa sobre el delta (cache en memoria) para no golpear AMI en cada
 * tick con acciones redundantes.
 */

const lastPausedByExtension = new Map<string, boolean>();

export async function syncAgentPauseStates(ami: AmiClient): Promise<void> {
  let states: Awaited<ReturnType<typeof getAgentPauseStates>>;
  try {
    states = await getAgentPauseStates();
  } catch (err) {
    logger.error({ err }, "No se pudo leer agent_current_status; se salta el sync de pausas este ciclo");
    return;
  }

  for (const state of states) {
    const previous = lastPausedByExtension.get(state.extension);
    if (previous === state.paused) continue;

    try {
      await amiAction(ami, {
        Action: "QueuePause",
        Interface: `PJSIP/${state.extension}`,
        Paused: state.paused ? "true" : "false",
        Reason: state.reasonLabel ?? "",
      });
      lastPausedByExtension.set(state.extension, state.paused);
      logger.info(
        { extension: state.extension, paused: state.paused, reason: state.reasonLabel },
        "Estado de pausa del agente sincronizado en Asterisk"
      );
    } catch (err) {
      // Común si el agente todavía no es miembro de ninguna cola (recién
      // provisionado, aún no asignado a campaña) — no es un error real.
      logger.warn({ err, extension: state.extension }, "QueuePause falló (¿agente sin cola asignada aún?)");
    }
  }
}
