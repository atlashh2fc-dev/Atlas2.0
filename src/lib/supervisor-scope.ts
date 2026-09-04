import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fuente única del alcance supervisor. La RPC deriva la identidad desde la
 * sesión y soporta varios supervisores por equipo sin confiar en filtros UI.
 */
export async function getSupervisedTeamIds(
  supabase: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("supervised_team_ids");
  if (error) throw new Error(error.message);
  return Array.isArray(data)
    ? data.filter((id): id is string => typeof id === "string")
    : [];
}
