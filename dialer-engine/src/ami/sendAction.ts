import type AmiClient from "asterisk-manager";

/**
 * Tope de espera para la respuesta de AMI. `asterisk-manager` no tiene uno:
 * si el socket se corta o Asterisk nunca contesta, el callback no llega y la
 * promesa queda pendiente para siempre. El 28-09-2026 un Originate sin
 * respuesta congeló el ciclo de campañas 25 minutos.
 */
export const AMI_ACTION_TIMEOUT_MS = 10_000;

export class AmiActionTimeoutError extends Error {
  constructor(action: string, timeoutMs: number) {
    super(`${action} sin respuesta de AMI en ${timeoutMs} ms`);
    this.name = "AmiActionTimeoutError";
  }
}

type AmiActionClient = Pick<AmiClient, "action">;

export function sendAmiAction(
  ami: AmiActionClient,
  action: Record<string, string | number | boolean | undefined>,
  timeoutMs = AMI_ACTION_TIMEOUT_MS
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AmiActionTimeoutError(String(action.Action ?? "Acción AMI"), timeoutMs));
    }, timeoutMs);
    ami.action(action, (err, res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(res);
    });
  });
}
