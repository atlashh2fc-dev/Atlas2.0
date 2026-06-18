import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { Search, PhoneCall } from "lucide-react";

export default async function LlamadasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireProfile();
  const { q } = await searchParams;
  const supabase = await createClient();

  let leads: { id: string; full_name: string; rut: string | null; phone: string | null; tipificacion_actual: string | null; workflow_status: string | null }[] = [];
  let error: string | null = null;

  if (q && q.trim()) {
    const term = q.trim();
    const { data, error: queryError } = await supabase
      .from("leads")
      .select("id, full_name, rut, phone, tipificacion_actual, workflow_status")
      .or(`rut.ilike.%${term}%,phone.ilike.%${term}%`)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (queryError) error = queryError.message;
    leads = data ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Llamadas</h1>
        <p className="text-sm text-muted-foreground">
          Busca un lead por RUT o teléfono para abrir su ficha de gestión.
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
          placeholder="RUT o teléfono..."
          autoFocus
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>

      {!q?.trim() && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          Ingresa un RUT o teléfono para buscar el lead que vas a gestionar.
        </div>
      )}

      {q?.trim() && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">RUT</th>
                <th className="px-5 py-3 font-medium">Teléfono</th>
                <th className="px-5 py-3 font-medium">Tipificación actual</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {error && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-danger">
                    Error al buscar: {error}
                  </td>
                </tr>
              )}
              {!error && leads.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                    No se encontraron leads para “{q}”.
                  </td>
                </tr>
              )}
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-surface-muted">
                  <td className="px-5 py-3 font-medium text-foreground">{lead.full_name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{lead.rut ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{lead.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{lead.tipificacion_actual ?? "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/llamadas/${lead.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      <PhoneCall size={14} />
                      Abrir ficha
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
