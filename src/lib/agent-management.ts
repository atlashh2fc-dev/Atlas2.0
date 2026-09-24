import "server-only";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Quién puede administrar la cuenta de un usuario: skills (campañas),
 * contraseña y activación.
 *
 * - Un admin, a cualquiera de su empresa (como siempre).
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

  if (actor.role === "admin") {
    return { actor, isAdmin: true as const, writer: await createClient() };
  }

  const supabase = await createClient();
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
