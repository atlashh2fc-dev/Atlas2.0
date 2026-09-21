import { redirect } from "next/navigation";
import { cache } from "react";

import { sesionActual } from "@/lib/sesion.server";
import type { Profile } from "@/lib/types";

/**
 * Layouts and pages call this helper independently during the same render.
 * React cache keeps that render to one round-trip instead of repeating it at
 * every nested dashboard boundary. The session itself lives in `sesionActual`,
 * which verifies the token locally and reads profile and company context in a
 * single RPC.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const sesion = await sesionActual();
  return sesion.estado === "activa" ? sesion.perfil : null;
});

export async function requireProfile(allowed?: Profile["role"][]) {
  const sesion = await sesionActual();
  // Token válido pero sesión cerrada a distancia: la pantalla de acceso lo
  // explica en vez de rebotar en silencio.
  if (sesion.estado === "revocada") redirect("/login?reason=forced_logout");
  if (sesion.estado !== "activa") redirect("/login");
  const profile = sesion.perfil;
  if (!profile.active) redirect("/login");
  if (allowed && !allowed.includes(profile.role)) redirect("/dashboard");
  return profile;
}
