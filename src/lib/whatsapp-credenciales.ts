import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El token de Meta con el que habla cada canal. Los números conectados desde
 * Atlas (registro insertado de la app de Altius) traen el suyo, guardado en la
 * bóveda; el canal de Geimser, conectado a mano con la app antigua, usa el del
 * entorno. Se cachea unos minutos: cada respuesta de Mercury no debería pagar
 * un viaje a la base por la credencial.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { token: string | null; hasta: number }>();

export async function tokenDelCanal(channelId?: string | null): Promise<string | null> {
  if (!channelId) return null;
  const guardado = cache.get(channelId);
  if (guardado && guardado.hasta > Date.now()) return guardado.token;
  const { data, error } = await createAdminClient().rpc("token_de_canal_whatsapp", { p_channel_id: channelId });
  if (error) throw new Error("No se pudo leer la credencial de WhatsApp del canal.");
  const token = typeof data === "string" && data.trim() ? data.trim() : null;
  cache.set(channelId, { token, hasta: Date.now() + CACHE_MS });
  return token;
}

/** El token del canal si tiene uno; si no, el del entorno. */
export async function accesoDeMeta(channelId?: string | null): Promise<string | null> {
  return (await tokenDelCanal(channelId)) ?? (process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null);
}

export function olvidarTokenDelCanal(channelId: string) {
  cache.delete(channelId);
}
