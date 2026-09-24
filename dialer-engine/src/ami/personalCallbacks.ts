/**
 * Agendas personales en vuelo.
 *
 * Una agenda personal no pasa por la Queue: suena primero el teléfono del
 * ejecutivo dueño y, cuando contesta, Asterisk marca al cliente con Dial (ver
 * originatePersonalCallback.ts). Por eso nunca llega AgentConnect, que es el
 * evento con el que el pool registra la conexión, crea la `calls`, inicia la
 * grabación y hace el screen-pop. Sin este registro el router trataba la
 * conversación como un cliente que contestó y nadie atendió: 'abandoned', sin
 * grabación, sin ficha y con el lead listo para volver a sonar.
 *
 * El motor ya sabe, desde el claim, a quién pertenece cada intento; aquí se
 * guarda para que DialEnd/Hangup puedan tratarlo como la conexión que es. Vive
 * en memoria igual que el resto de la correlación AMI: si el proceso se
 * reinicia, los eventos de esas llamadas tampoco se correlacionan.
 */
export type PersonalCallbackInFlight = {
  agentId: string;
  extension: string;
  campaignId: string;
  /** Momento en que el cliente contestó; da el tiempo de conversación. */
  answeredAtMs?: number;
  /** DialStatus de la pata del cliente cuando no contestó. */
  customerDialStatus?: string;
};

const inFlight = new Map<string, PersonalCallbackInFlight>();

export function trackPersonalCallback(
  dialAttemptId: string,
  owner: Pick<PersonalCallbackInFlight, "agentId" | "extension" | "campaignId">
): void {
  inFlight.set(dialAttemptId, { ...owner });
}

export function getPersonalCallback(dialAttemptId: string): PersonalCallbackInFlight | undefined {
  return inFlight.get(dialAttemptId);
}

export function forgetPersonalCallback(dialAttemptId: string): void {
  inFlight.delete(dialAttemptId);
}
