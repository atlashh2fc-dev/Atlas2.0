import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Quién está mirando y en qué empresa, en un solo viaje a la base.
 *
 * Antes cada pantalla hacía tres llamadas en fila (validar la sesión con el
 * servidor de Auth, comprobar que no estuviera cerrada a distancia y leer el
 * perfil) y luego una cuarta para el contexto de la empresa. Ahora el token se
 * verifica acá mismo con la clave pública de Supabase, sin red, y la RPC
 * `sesion_actual` entrega perfil y contexto juntos. Se cachea por petición:
 * layout, menú y página lo piden por separado y es la misma respuesta.
 */
export type SesionActual =
  /** No hay token o no es válido. */
  | { estado: "sin_sesion" }
  /** El token es válido pero la sesión fue cerrada a distancia o el perfil está inactivo. */
  | { estado: "revocada" }
  | { estado: "activa"; perfil: Profile; contexto: unknown };

export const sesionActual = cache(async (): Promise<SesionActual> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { estado: "sin_sesion" };

  const { data, error } = await supabase.rpc("sesion_actual");
  if (error) throw new Error(error.message);

  const sesion = data as { perfil?: unknown; contexto?: unknown } | null;
  if (!sesion || typeof sesion !== "object" || !sesion.perfil || typeof sesion.perfil !== "object") {
    return { estado: "revocada" };
  }
  return { estado: "activa", perfil: sesion.perfil as Profile, contexto: sesion.contexto };
});
