import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import { getAgentPauseStates } from "../supabaseClient";
import { amiAction } from "../asterisk/configSync";
import { BUSY_HOLD_REASON } from "./pauseDecision";

/**
 * Sincroniza el estado del agente (Disponible o un motivo AUX concreto,
 * elegido desde la barra CTI) hacia Asterisk via AMI
 * QueuePause. No se especifica Queue en la acción: Asterisk pausa/despausa
 * al Interface en TODAS las colas de las que sea miembro, así no hace falta
 * saber a qué campañas está asignado el agente en este módulo.
 *
 * Solo actúa sobre el delta (cache en memoria) para no golpear AMI en cada
 * tick con acciones redundantes.
 */

const lastPausedByExtension = new Map<string, boolean>();

/** Cuánto manda una pausa por evento antes de que la base la refleje. */
const BUSY_HOLD_GRACE_MS = 20_000;

/** Extensiones cuya última pausa fue por ocupación, no por AUX ni cierre. */
const busyHoldExtensions = new Set<string>();
/** Pausas recién dadas por evento: el sync no las levanta antes de tiempo. */
const busyHoldUntil = new Map<string, number>();

function heldByRecentEvent(extension: string, now = Date.now()): boolean {
  const until = busyHoldUntil.get(extension);
  if (until === undefined) return false;
  if (until > now) return true;
  busyHoldUntil.delete(extension);
  return false;
}

/**
 * true si Asterisk tiene al ejecutivo pausado por ocupación. El router de
 * eventos lo usa para no escribir 'paused' en su sesión de discado.
 */
export function isHeldForBusy(extension: string): boolean {
  return busyHoldExtensions.has(extension);
}

export async function pauseAgentForWrapUp(ami: AmiClient, extension: string): Promise<void> {
  await amiAction(ami, {
    Action: "QueuePause",
    Interface: `PJSIP/${extension}`,
    Paused: "true",
    Reason: "Cierre y tipificación",
  });
  lastPausedByExtension.set(extension, true);
  busyHoldExtensions.delete(extension);
}

/**
 * Pausa inmediata en la cola porque el ejecutivo acaba de tomar otra
 * gestión (le va a sonar su agenda o empezó una llamada manual). No espera
 * al sync periódico: en esos segundos el predictivo ya le podía entregar un
 * cliente. El sync la mantiene mientras la base diga que sigue ocupado.
 */
export async function holdAgentWhileBusy(ami: AmiClient, extension: string): Promise<void> {
  busyHoldUntil.set(extension, Date.now() + BUSY_HOLD_GRACE_MS);
  // Marcada antes de la acción: el evento QueueMemberPause puede llegar
  // antes que la respuesta y no debe dejar la sesión en 'paused'.
  busyHoldExtensions.add(extension);
  try {
    await amiAction(ami, {
      Action: "QueuePause",
      Interface: `PJSIP/${extension}`,
      Paused: "true",
      Reason: BUSY_HOLD_REASON,
    });
  } catch (err) {
    busyHoldUntil.delete(extension);
    if (lastPausedByExtension.get(extension) !== true) busyHoldExtensions.delete(extension);
    throw err;
  }
  lastPausedByExtension.set(extension, true);
}

/**
 * Despausa al ejecutivo apenas Atlas lo dejó 'available' (cierre de la
 * tipificación), sin esperar al ciclo periódico de sincronización: esa espera
 * de hasta 10 s era una ventana en la que el motor ya contaba al ejecutivo
 * como libre pero Asterisk todavía no le entregaba llamadas, y un cliente
 * que contestaba en ese lapso quedaba en la cola escuchando silencio.
 *
 * Devuelve false si no despausó porque el ejecutivo acaba de tomar otra
 * gestión (su agenda empezó a sonar justo al cerrar la anterior).
 */
export async function resumeAgentAfterWrapUp(ami: AmiClient, extension: string): Promise<boolean> {
  if (heldByRecentEvent(extension)) return false;
  await amiAction(ami, {
    Action: "QueuePause",
    Interface: `PJSIP/${extension}`,
    Paused: "false",
    Reason: "",
  });
  lastPausedByExtension.set(extension, false);
  busyHoldExtensions.delete(extension);
  return true;
}

export async function syncAgentPauseStates(
  ami: AmiClient,
  options: { force?: boolean } = {}
): Promise<void> {
  let states: Awaited<ReturnType<typeof getAgentPauseStates>>;
  try {
    states = await getAgentPauseStates();
  } catch (err) {
    logger.error({ err }, "No se pudo leer agent_current_status; se salta el sync de pausas este ciclo");
    return;
  }

  for (const state of states) {
    // Una pausa por evento recién dada manda sobre una lectura de la base
    // que todavía no ve la gestión nueva.
    if (!state.paused && heldByRecentEvent(state.extension)) continue;

    const previous = lastPausedByExtension.get(state.extension);
    const holdChanged = state.busyHold !== busyHoldExtensions.has(state.extension);
    if (!options.force && previous === state.paused && !holdChanged) continue;

    // Antes de la acción, igual que en holdAgentWhileBusy: el evento de
    // pausa puede llegar antes que la respuesta.
    if (state.busyHold) busyHoldExtensions.add(state.extension);
    else busyHoldExtensions.delete(state.extension);

    // Solo cambió el motivo entre dos pausas: Asterisk ya lo tiene pausado.
    if (!options.force && previous === state.paused) continue;

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
