import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assignLead, reassignAgenda } from "@/app/actions/admin";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Convierte un ISO timestamp al formato que espera <input type="datetime-local">. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  const { data: agendaLeads } = await supabase
    .from("leads")
    .select("id, full_name, rut, phone, next_action_at, managed_by, profiles!leads_managed_by_fkey(full_name)")
    .eq("team_id", profile.team_id)
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(100);

  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Mi equipo</h1>
        <p className="text-sm text-muted-foreground">
          Asigna leads a los agentes de tu equipo y monitorea su avance.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Agendas del equipo</h2>
          <p className="text-xs text-muted-foreground">
            Próximas llamadas agendadas por tus ejecutivos. Puedes reasignar la responsable y/o ajustar la fecha.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Ejecutivo</th>
              <th className="px-5 py-3 font-medium">Agenda</th>
              <th className="px-5 py-3 font-medium">Reagendar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(agendaLeads ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  No hay agendas pendientes en tu equipo.
                </td>
              </tr>
            )}
            {(agendaLeads ?? []).map((lead) => {
              const isOverdue = new Date(lead.next_action_at!) <= now;
              const managerName = one(lead.profiles as ProfileEmbed)?.full_name ?? "—";
              return (
                <tr key={lead.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{lead.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{managerName}</td>
                  <td className={`px-5 py-3 ${isOverdue ? "font-medium text-danger" : "text-foreground"}`}>
                    {isOverdue ? "Vencida: " : ""}
                    {new Date(lead.next_action_at!).toLocaleString("es-CL")}
                  </td>
                  <td className="px-5 py-3">
                    <form action={reassignAgenda} className="flex items-center gap-2">
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <select
                        name="agent_id"
                        defaultValue={lead.managed_by ?? ""}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        {(agents ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="datetime-local"
                        name="next_action_at"
                        defaultValue={toDatetimeLocal(lead.next_action_at!)}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                      >
                        Reagendar
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Asignación de leads</h2>
        </div>
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
