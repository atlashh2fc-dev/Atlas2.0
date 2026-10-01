import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * ¿La petición trae el `Authorization: Bearer <CRON_SECRET>` de Vercel Cron?
 *
 * Compara en tiempo constante: con `===` el tiempo de respuesta delata cuántos
 * caracteres del secreto acertó quien prueba. Se comparan los hash para que
 * los largos distintos tampoco se noten.
 */
export function cronAutorizado(request: Request): boolean {
  const esperado = process.env.CRON_SECRET?.trim();
  if (!esperado) return false;
  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const hash = (valor: string) => createHash("sha256").update(valor).digest();
  return timingSafeEqual(hash(recibido), hash(esperado));
}
