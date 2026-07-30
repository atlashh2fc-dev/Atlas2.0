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
/**
 * Deja el número en formato internacional sin '+'. El prefijo del carrier
 * espera código de país: un número nacional de 9 dígitos (22..., 9...) se
 * concatenaba tal cual y Siptel lo rechazaba o lo enrutaba mal. En la base hay
 * ~3.600 registros en ese formato.
 */
export function toInternational(phone: string, countryCode = "56"): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith(countryCode) && digits.length >= 11) return digits;
  if (digits.length === 9) return `${countryCode}${digits}`;
  // 8 dígitos: fijo antiguo sin el 2 inicial de Santiago.
  if (digits.length === 8) return `${countryCode}2${digits}`;
  return digits;
}

export function originateCall(params: OriginateParams): Promise<void> {
  const { ami, target, queueName, callerId, trunkContext, abandonTimeoutSeconds, amdEnabled } = params;
  // El carrier (Siptel) exige el prefijo de marcación antepuesto al destino en
  // el Request-URI: DIAL_PREFIX + código de país + número nacional, sin '+'.
  // Se limpian separadores y el '+' para no romper el URI.
  const dialNumber = `${config.dialPrefix}${toInternational(target.phone)}`;
  const channel = `${config.dialTech}/${dialNumber}@${trunkContext}`;
  const queueData = abandonTimeoutSeconds ? `${queueName},,,,${abandonTimeoutSeconds}` : queueName;

  const action: Record<string, string> = {
    Action: "Originate",
    // `asterisk-manager` solo respeta esta clave en minúsculas. Con
    // `ActionID` generaba un timestamp propio y rompía la correlación con el
    // UUID de dial_attempts aunque la llamada sí se cursara.
    actionid: target.dial_attempt_id,
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
