import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { Search } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";

const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.label]));

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireProfile();
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, full_name, rut, phone, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (q && q.trim()) {
    const term = q.trim();
    query = query.or(`rut.ilike.%${term}%,phone.ilike.%${term}%,full_name.ilike.%${term}%`);
  }

  const { data: leads, error } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Busca por RUT, teléfono o nombre.
        </p>
      </div>

      <form className="relative max-w-md">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="RUT, teléfono o nombre..."
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">RUT</th>
              <th className="px-5 py-3 font-medium">Teléfono</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium">Actualizado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {error && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-danger">
                  Error al cargar leads: {error.message}
                </td>
              </tr>
            )}
            {!error && (leads ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  No se encontraron leads.
                </td>
              </tr>
            )}
            {(leads ?? []).map((lead) => (
              <tr key={lead.id} className="hover:bg-surface-muted">
                <td className="px-5 py-3">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {lead.full_name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{lead.rut ?? "—"}</td>
                <td className="px-5 py-3 text-muted-foreground">{lead.phone ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                    {STATUS_LABEL[lead.status] ?? lead.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {new Date(lead.updated_at).toLocaleDateString("es-CL")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
