import "server-only";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Quién puede administrar la cuenta de un usuario: skills (campañas),
 * contraseña y activación.
 *
 * - Un admin, a cualquiera de sus empresas, salvo al dueño de la plataforma.
 * - Un supervisor, solo a los ejecutivos de los equipos que supervisa
 *   (supervised_team_ids: supervisor principal o co-supervisor). Nunca a otro
 *   supervisor ni a un admin, y nunca cambia roles ni equipos: eso sigue
 *   siendo de administración.
 *
 * Las escrituras del supervisor van con la llave de servicio porque la
 * seguridad por fila de profiles y campaign_agents es solo de admin; por eso
 * la autorización se decide aquí, antes, y fila por fila.
 */
export async function requireAgentManager(targetUserIds: string[]) {
  const actor = await requireProfile(["admin", "supervisor"]);
  const ids = [...new Set(targetUserIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("No se identificó el usuario.");

  const supabase = await createClient();

  if (actor.role === "admin") {
    // Admin, pero de SU empresa: antes volvía sin mirar el destino y, como la
    // contraseña se cambia con la llave de servicio, un admin de una empresa
    // podía tomar cuentas de otra. Con la sesión, la seguridad por fila solo
    // deja ver a la gente de sus empresas; si falta alguno, no es suyo.
    const { data: visibles, error: visiblesError } = await supabase.from("profiles").select("id").in("id", ids);
    if (visiblesError) throw new Error("No se pudo comprobar a quién quieres administrar. Intenta de nuevo.");
    if ((visibles ?? []).length !== ids.length) {
      throw new Error("Solo puedes administrar a personas de tu empresa.");
    }

    // Las cuentas del dueño de la plataforma no las administra un admin de
    // empresa, aunque el dueño sea miembro de todas.
    const [{ data: esDuenio }, { data: duenios, error: dueniosError }] = await Promise.all([
      supabase.rpc("is_platform_owner"),
      createAdminClient().from("platform_owners").select("profile_id").in("profile_id", ids),
    ]);
    if (dueniosError) throw new Error("No se pudo comprobar a quién quieres administrar. Intenta de nuevo.");
    if (esDuenio !== true && (duenios ?? []).length > 0) {
      throw new Error("Esa cuenta la administra el dueño de la plataforma.");
    }

    return { actor, isAdmin: true as const, writer: supabase };
  }

  const { data: teamIds, error: scopeError } = await supabase.rpc("supervised_team_ids");
  if (scopeError) throw new Error(scopeError.message);
  const supervised = new Set((teamIds ?? []) as string[]);
  if (supervised.size === 0) throw new Error("No tienes equipos asignados para administrar.");

  const admin = createAdminClient();
  const { data: targets, error } = await admin
    .from("profiles")
    .select("id, role, team_id")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const allowed = (targets ?? []).filter(
    (target) => target.role === "agente" && target.team_id !== null && supervised.has(target.team_id)
  );
  if (allowed.length !== ids.length) {
    throw new Error("Solo puedes administrar a los ejecutivos de tus equipos.");
  }

  return { actor, isAdmin: false as const, writer: admin };
}
