import type AmiClient from "asterisk-manager";
import { config } from "../config";
import { logger } from "../logger";
import type { ClaimedTarget } from "../supabaseClient";

export type OriginateParams = {
  ami: AmiClient;
  target: ClaimedTarget;
  campaignId: string;
  queueName: string;
  callerId?: string | null;
  trunkContext: string;
  /** Segundos máximos que un cliente ya contestado espera en la cola sin
   * agente libre antes de cortar (se registra como 'abandoned'). Sin esto,
   * con leavewhenempty=no/joinempty=yes, un cliente podía quedar esperando
   * indefinidamente si todos los agentes estaban pausados/offline. */
  abandonTimeoutSeconds?: number;
  /** Si true, la llamada pasa primero por AMD() (detección de contestador)
   * antes de llegar a la Queue — ver AMD_CONTEXT en configSync.ts. Default
   * false: comportamiento idéntico al de siempre (directo a la Queue). */
  amdEnabled?: boolean;
};

/** Debe coincidir con el nombre de contexto que provisiona ensureAmdContext() en configSync.ts. */
export const AMD_CONTEXT = "dialer-amd-out";

/**
 * Origina la pata saliente y, al contestar, la deja directo en la Queue de
 * Asterisk — Asterisk mismo decide a qué agente conectar (estrategia de la
 * queue: ringall/leastrecent/etc). Así el motor no reimplementa distribución
 * de agentes, que es exactamente lo que hace frágil a un discador casero.
 *
 * Si la campaña tiene AMD habilitado, en vez de Application=Queue directo
 * se origina hacia AMD_CONTEXT (dialplan propio que corre AMD() y solo deja
 * pasar a la Queue si detecta humano) — QUEUE_NAME va como variable de
 * canal porque el contexto es genérico y no sabe de antemano a qué cola
 * corresponde esta llamada en particular.
 *
 * ActionID = dial_attempt_id: permite correlacionar el OriginateResponse (y
 * el resto de eventos de este canal) sin mantener estado propio más allá del
 * mapeo uniqueid -> dial_attempt_id que arma el event router al recibir la
 * respuesta.
 */
export function originateCall(params: OriginateParams): Promise<void> {
  const { ami, target, queueName, callerId, trunkContext, abandonTimeoutSeconds, amdEnabled } = params;
  const channel = `${config.dialTech}/${target.phone}@${trunkContext}`;
  const queueData = abandonTimeoutSeconds ? `${queueName},,,,${abandonTimeoutSeconds}` : queueName;

  const action: Record<string, string> = {
    Action: "Originate",
    ActionID: target.dial_attempt_id,
    Channel: channel,
    Async: "true",
    Timeout: "30000",
  };
  if (callerId) action.CallerID = callerId;

  if (amdEnabled) {
    action.Context = AMD_CONTEXT;
    action.Exten = "s";
    action.Priority = "1";
    action.Variable = `DIAL_ATTEMPT_ID=${target.dial_attempt_id},QUEUE_NAME=${queueData}`;
  } else {
    action.Context = trunkContext;
    action.Application = "Queue";
    action.Data = queueData;
    action.Variable = `DIAL_ATTEMPT_ID=${target.dial_attempt_id}`;
  }

  return new Promise((resolve, reject) => {
    ami.action(action, (err) => {
      if (err) {
        logger.error({ err, target }, "Fallo al enviar Originate");
        reject(err);
        return;
      }
      resolve();
    });
  });
}
