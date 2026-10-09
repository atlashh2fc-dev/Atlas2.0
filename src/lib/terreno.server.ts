import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CampanaTerreno } from "@/lib/terreno";

export const COOKIE_CAMPANA = "terreno_campana";

/** Campañas de terreno activas a las que llega la persona. */
export const misCampanasTerreno = cache(async (): Promise<CampanaTerreno[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("terreno_mis_campanas");
  if (error) {
    console.error("[terreno] no se pudieron leer las campañas", error.message);
    return [];
  }
  return (data ?? []) as CampanaTerreno[];
});

/**
 * La campaña en la que está trabajando: la que eligió (cookie) si sigue
 * disponible, si no la primera. Casi siempre hay una sola.
 */
export const campanaTerrenoActual = cache(async (): Promise<CampanaTerreno | null> => {
  const campanas = await misCampanasTerreno();
  if (campanas.length === 0) return null;
  const elegida = (await cookies()).get(COOKIE_CAMPANA)?.value;
  return campanas.find((campana) => campana.id === elegida) ?? campanas[0];
});

/**
 * URLs firmadas (1 hora) de las fotos de visitas que la persona ya pudo leer
 * por RLS. Solo se firman rutas que llegaron de esa lectura, nunca de la URL.
 */
export async function firmarFotosTerreno(paths: (string | null)[]): Promise<Map<string, string>> {
  const unicas = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (unicas.length === 0) return new Map();
  const { data, error } = await createAdminClient().storage.from("terreno-visitas").createSignedUrls(unicas, 3600);
  if (error) {
    console.error("[terreno] no se pudieron firmar las fotos", error.message);
    return new Map();
  }
  const firmadas = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) firmadas.set(item.path, item.signedUrl);
  }
  return firmadas;
}
