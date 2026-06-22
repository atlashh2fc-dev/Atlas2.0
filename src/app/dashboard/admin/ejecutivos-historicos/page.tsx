import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { activateHistoricalAgent } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

export default async function HistoricalAgentsAdminPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("historical_agents")
    .select("id, full_name, legacy_system, legacy_executive_id, linked_profile_id, created_at")
    .order("full_name");

  const { data: teams } = await supabase.from("teams").select("*").order("name");

  const { data: callCounts } = await supabase
    .from("calls")
    .select("historical_agent_id")
    .not("historical_agent_id", "is", null);

  const countsByAgent = new Map<string, number>();
  for (const row of callCounts ?? []) {
    const id = row.historical_agent_id as string;
    countsByAgent.set(id, (countsByAgent.get(id) ?? 0) + 1);
  }

  const linkedProfileIds = (agents ?? [])
    .map((a) => a.linked_profile_id)
    .filter((id): id is string => !!id);

  const { data: linkedProfiles } = linkedProfileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", linkedProfileIds)
    : { data: [] };

  const profileOf = (id: string | null) => (linkedProfiles ?? []).find((p) => p.id === id) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Ejecutivos históricos</h1>
        <p className="text-sm text-muted-foreground">
          Personas que aparecen en la gestión heredada de un CRM legado. Mientras no se activen,
          su historial queda registrado pero sin login propio. Activar un ejecutivo crea una
          cuenta real y le reasigna todo su historial de llamadas, sin perder la trazabilidad al
          origen legado.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Ejecutivo (legado)</th>
              <th className="px-5 py-3 font-medium">Sistema origen</th>
              <th className="px-5 py-3 font-medium">Llamadas históricas</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium">Activar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(agents ?? []).map((a) => {
              const linked = profileOf(a.linked_profile_id);
              const calls = countsByAgent.get(a.id) ?? 0;
              return (
                <tr key={a.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{a.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.legacy_system}</td>
                  <td className="px-5 py-3 text-muted-foreground">{calls}</td>
                  <td className="px-5 py-3">
                    {linked ? (
                      <span className="inline-flex items-center rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success">
                        Activo como {linked.full_name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Sin activar
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {linked ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-primary">
                          Activar ejecutivo
                        </summary>
                        <form
                          action={activateHistoricalAgent}
                          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-3"
                        >
                          <input type="hidden" name="historical_agent_id" value={a.id} />
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Correo</label>
                            <input
                              type="email"
                              name="email"
                              required
                              placeholder="correo@ejemplo.com"
                              className="w-52 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Contraseña</label>
                            <input
                              type="text"
                              name="password"
                              required
                              minLength={6}
                              placeholder="Mínimo 6 caracteres"
                              className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Rol</label>
                            <select
                              name="role"
                              defaultValue="agente"
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Equipo</label>
                            <select
                              name="team_id"
                              defaultValue=""
                              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                            >
                              <option value="">Sin equipo</option>
                              {(teams ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="submit"
                            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                          >
                            Crear cuenta y activar
                          </button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {(agents ?? []).length === 0 && (
              <tr>
                <td className="px-5 py-6 text-center text-muted-foreground" colSpan={5}>
                  No hay ejecutivos históricos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
