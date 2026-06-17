import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assignLead } from "@/app/actions/admin";

export default async function TeamPage() {
  const profile = await requireProfile(["supervisor"]);
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("team_id", profile.team_id)
    .eq("role", "agente");

  const { data: leads } = await supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, assigned_to")
    .order("updated_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Mi equipo</h1>
        <p className="text-sm text-muted-foreground">
          Asigna leads a los agentes de tu equipo y monitorea su avance.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">RUT</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium">Asignado a</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(leads ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  No hay leads en tu equipo todavía.
                </td>
              </tr>
            )}
            {(leads ?? []).map((lead) => (
              <tr key={lead.id}>
                <td className="px-5 py-3 font-medium text-foreground">{lead.full_name}</td>
                <td className="px-5 py-3 text-muted-foreground">{lead.rut ?? "—"}</td>
                <td className="px-5 py-3 text-muted-foreground">{lead.status}</td>
                <td className="px-5 py-3">
                  <form action={assignLead} className="flex items-center gap-2">
                    <input type="hidden" name="lead_id" value={lead.id} />
                    <select
                      name="agent_id"
                      defaultValue={lead.assigned_to ?? ""}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Sin asignar</option>
                      {(agents ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      Asignar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
