import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MyAgendaPage() {
  const profile = await requireProfile(["agente", "admin"]);
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("id, full_name, rut, phone, next_action_at, tipificacion_actual")
    .eq("managed_by", profile.id)
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(100);

  const now = new Date();
  const overdue = (leads ?? []).filter((l) => new Date(l.next_action_at!) <= now);
  const upcoming = (leads ?? []).filter((l) => new Date(l.next_action_at!) > now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Mi agenda</h1>
        <p className="text-sm text-muted-foreground">
          Todas tus próximas llamadas agendadas, vencidas primero.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">RUT / Teléfono</th>
              <th className="px-5 py-3 font-medium">Tipificación actual</th>
              <th className="px-5 py-3 font-medium">Agenda</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(leads ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  No tienes agendas pendientes.
                </td>
              </tr>
            )}
            {[...overdue, ...upcoming].map((l) => {
              const isOverdue = new Date(l.next_action_at!) <= now;
              return (
                <tr key={l.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{l.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{l.rut ?? l.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{l.tipificacion_actual ?? "—"}</td>
                  <td className={`px-5 py-3 ${isOverdue ? "font-medium text-danger" : "text-foreground"}`}>
                    {isOverdue ? "Vencida: " : ""}
                    {new Date(l.next_action_at!).toLocaleString("es-CL")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/leads/${l.id}`}
                      className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      Llamar ahora
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
