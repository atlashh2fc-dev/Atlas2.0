import { createAdminClient } from "@/lib/supabase/admin";
import { sortDemoAccounts, type DemoViewAccount } from "@/lib/demo-view";
import type { Profile } from "@/lib/types";

/**
 * Cuentas entre las que puede alternar una demostración: las del mismo equipo,
 * marcadas como demo y activas.
 *
 * Va con la clave de servicio porque la RLS de `profiles` no deja que un
 * ejecutivo lea a sus compañeros, y acá solo se devuelven nombre y rol de
 * cuentas de demostración. Es un módulo de servidor: no lo importe un
 * componente de cliente.
 */
export async function listDemoViewAccounts(profile: Profile): Promise<DemoViewAccount[]> {
  if (!profile.is_demo || !profile.team_id) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("team_id", profile.team_id)
    .eq("is_demo", true)
    .eq("active", true)
    .in("role", ["agente", "supervisor"]);

  // Un fallo acá no puede tumbar el panel entero: sin lista, el selector
  // simplemente no aparece.
  if (error) return [];
  return sortDemoAccounts((data ?? []) as DemoViewAccount[]);
}
