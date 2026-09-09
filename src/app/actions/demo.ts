"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoViewRole } from "@/lib/demo-view";

/**
 * Cambia la sesión entre las cuentas de demostración de un mismo equipo.
 *
 * Es un cambio de cuenta real: la sesión nueva se emite con un enlace de acceso
 * de un solo uso, así que la RLS entrega exactamente lo que vería esa persona.
 * No hay nada simulado y tampoco hay contraseñas dando vueltas en el cliente.
 *
 * Los guardias son tres y todos importan: quien pide el cambio tiene que ser
 * una cuenta demo, el destino tiene que ser otra cuenta demo activa del mismo
 * equipo, y su rol tiene que ser ejecutivo o supervisor. Sin eso esto sería un
 * salto de privilegios: marcar como demo a un admin abriría la puerta a su
 * sesión.
 */
export async function switchDemoAccount(targetProfileId: string) {
  const profile = await requireProfile();

  if (!profile.is_demo) {
    throw new Error("Solo las cuentas de demostración pueden cambiar de vista.");
  }
  if (!profile.team_id) {
    throw new Error("La cuenta de demostración no tiene equipo asignado.");
  }
  if (targetProfileId === profile.id) return;

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, email, role, team_id, active, is_demo")
    .eq("id", targetProfileId)
    .maybeSingle();

  if (targetError) throw new Error(targetError.message);
  if (
    !target ||
    !target.is_demo ||
    !target.active ||
    target.team_id !== profile.team_id ||
    !isDemoViewRole(target.role) ||
    !target.email
  ) {
    throw new Error("Esa vista no está disponible para esta demostración.");
  }

  // `generateLink` no envía correo: solo emite el token de un uso que la sesión
  // del servidor canjea a continuación.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.email,
  });
  if (linkError) throw new Error(linkError.message);

  const tokenHash = link?.properties?.hashed_token;
  if (!tokenHash) throw new Error("No fue posible preparar la vista de demostración.");

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) throw new Error(verifyError.message);

  // El menú, las insignias y el alcance de cada consulta se arman en el layout
  // del servidor con el perfil de la sesión.
  revalidatePath("/dashboard", "layout");
}
