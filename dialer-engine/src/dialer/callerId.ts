import { createHash } from "node:crypto";

/**
 * Qué número ve el cliente en cada intento (caller ID).
 *
 * Con varios números en `caller_ids` se reparte por hash de rendezvous
 * (highest random weight) sobre el lead_id: cada número recibe un puntaje
 * sha256(lead_id|número) y gana el más alto. Se eligió sobre round-robin por
 * tres razones:
 *   - El mismo lead sale siempre con el mismo número, en cualquier ciclo y
 *     tras reiniciar el motor, sin guardar estado: quien devuelve la llamada
 *     reconoce el número que lo llamó.
 *   - Quitar un número de la lista (porque quedó marcado como spam o Siptel
 *     lo dio de baja) solo mueve a los leads que tenía ese número; con un
 *     hash módulo N, o con round-robin, se barajaría a casi todos.
 *   - El reparto es parejo y al azar respecto de la base, así que la
 *     contactabilidad de cada número se puede comparar sin sesgo.
 *
 * Sin lista (o vacía) se usa `caller_id` tal cual, como siempre.
 */

export type CallerIdConfig = {
  caller_id: string | null;
  caller_ids?: readonly (string | null)[] | null;
};

/** Números candidatos de la campaña, en orden y sin vacíos ni repetidos. */
export function callerIdPool(cfg: CallerIdConfig): string[] {
  const pool: string[] = [];
  for (const raw of cfg.caller_ids ?? []) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value && !pool.includes(value)) pool.push(value);
  }
  if (pool.length > 0) return pool;
  const single = cfg.caller_id?.trim();
  return single ? [single] : [];
}

function score(leadId: string, callerId: string): number {
  // 48 bits caben exactos en un number y sobran para desempatar.
  return createHash("sha256").update(`${leadId}|${callerId}`).digest().readUIntBE(0, 6);
}

/** Número para este lead, o null si la campaña no tiene ninguno configurado. */
export function pickCallerId(pool: readonly string[], leadId: string): string | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  let best = pool[0];
  let bestScore = score(leadId, best);
  for (let i = 1; i < pool.length; i += 1) {
    const candidate = pool[i];
    const candidateScore = score(leadId, candidate);
    if (candidateScore > bestScore || (candidateScore === bestScore && candidate < best)) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}
