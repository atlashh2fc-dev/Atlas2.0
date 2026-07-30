import type AmiClient from "asterisk-manager";
import { config } from "../config";
import { logger } from "../logger";
import { toInternational } from "./originate";

export type PersonalCallbackTarget = {
  dial_attempt_id: string;
  lead_id: string;
  phone: string;
  full_name: string;
  rut: string | null;
  agent_id: string;
  agent_extension: string;
};

/**
 * Entrega de un compromiso agendado: suena PRIMERO el teléfono del ejecutivo
 * que lo agendó y, cuando contesta, recién ahí se marca al cliente.
 *
 * Es al revés que la marcación de campaña (que llama al cliente y lo mete a la
 * cola) y es a propósito: un compromiso es con una persona concreta. Si se
 * marcara primero al cliente y el ejecutivo no alcanzara a contestar, el
 * cliente quedaría escuchando el tono de una llamada que él pidió — que es
 * justo lo que no puede pasar. Además, así ningún otro ejecutivo puede tomarla:
 * la llamada nunca pasa por la cola compartida.
 *
 * Genesys y Five9 llaman a esto "personal callback" y lo resuelven igual.
 */
export function originatePersonalCallback(params: {
  ami: AmiClient;
  target: PersonalCallbackTarget;
  callerId: string | null;
  trunkContext: string;
  /** Segundos que suena el teléfono del ejecutivo antes de desistir. */
  agentRingSeconds?: number;
}): Promise<void> {
  const { ami, target, callerId, trunkContext, agentRingSeconds = 20 } = params;

  const customerNumber = `${config.dialPrefix}${toInternational(target.phone)}`;
  const agentChannel = `${config.dialTech}/${target.agent_extension}`;

  const action: Record<string, string> = {
    Action: "Originate",
    // Minúscula: es la única forma que respeta `asterisk-manager` y sin esto se
    // pierde la correlación con dial_attempts.
    actionid: target.dial_attempt_id,
    Channel: agentChannel,
    Async: "true",
    Timeout: String(agentRingSeconds * 1000),
    // Cuando el ejecutivo contesta, Asterisk marca al cliente y los une.
    Application: "Dial",
    Data: `${config.dialTech}/${customerNumber}@${trunkContext},30`,
    Variable: [
      `DIAL_ATTEMPT_ID=${target.dial_attempt_id}`,
      `ATLAS_CALLBACK=1`,
      `ATLAS_AGENT_ID=${target.agent_id}`,
      `ATLAS_LEAD_ID=${target.lead_id}`,
    ].join(","),
  };

  // El cliente ve el número de la campaña, no la extensión interna.
  if (callerId) action.CallerID = callerId;

  return new Promise((resolve, reject) => {
    ami.action(action, (err) => {
      if (err) {
        logger.error({ err, target }, "Fallo al entregar el compromiso agendado");
        reject(err);
        return;
      }
      logger.info(
        {
          dialAttemptId: target.dial_attempt_id,
          agentExtension: target.agent_extension,
          leadId: target.lead_id,
        },
        "Compromiso agendado entregado a su ejecutivo"
      );
      resolve();
    });
  });
}
