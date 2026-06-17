import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createWorkflow, toggleWorkflowActive } from "@/app/actions/workflows";
import Link from "next/link";

export default async function WorkflowsPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: workflows } = await supabase
    .from("workflows")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Flujos de gestión</h1>
        <p className="text-sm text-muted-foreground">
          Define los pasos obligatorios que los agentes deben completar al gestionar un lead.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">Descripción</th>
              <th className="px-5 py-3 font-medium">Estado</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(workflows ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  Todavía no hay flujos creados.
                </td>
              </tr>
            )}
            {(workflows ?? []).map((w) => (
              <tr key={w.id}>
                <td className="px-5 py-3 font-medium text-foreground">
                  <Link href={`/dashboard/admin/flujos/${w.id}`} className="hover:text-primary">
                    {w.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{w.description ?? "—"}</td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      w.is_active ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                    }`}
                  >
                    {w.is_active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <form action={toggleWorkflowActive}>
                    <input type="hidden" name="workflow_id" value={w.id} />
                    <input type="hidden" name="active" value={String(w.is_active)} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      {w.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear flujo</h2>
        <form action={createWorkflow} className="flex max-w-xl flex-col gap-3 sm:flex-row">
          <input
            type="text"
            name="name"
            required
            placeholder="Nombre del flujo"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <input
            type="text"
            name="description"
            placeholder="Descripción (opcional)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear y configurar pasos
          </button>
        </form>
      </div>
    </div>
  );
}
