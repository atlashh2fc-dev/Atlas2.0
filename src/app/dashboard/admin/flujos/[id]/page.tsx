import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addWorkflowStep, deleteWorkflowStep } from "@/app/actions/workflows";
import { notFound } from "next/navigation";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", id)
    .single();

  if (!workflow) notFound();

  const { data: steps } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", id)
    .order("step_order", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{workflow.name}</h1>
        <p className="text-sm text-muted-foreground">
          {workflow.description || "Sin descripción."}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">#</th>
              <th className="px-5 py-3 font-medium">Paso</th>
              <th className="px-5 py-3 font-medium">Obligatorio</th>
              <th className="px-5 py-3 font-medium">Resultados permitidos</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(steps ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Este flujo todavía no tiene pasos.
                </td>
              </tr>
            )}
            {(steps ?? []).map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3 text-muted-foreground">{s.step_order}</td>
                <td className="px-5 py-3 font-medium text-foreground">
                  {s.name}
                  {s.description && (
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      s.is_mandatory ? "bg-warning-bg text-warning" : "bg-surface-muted text-muted-foreground"
                    }`}
                  >
                    {s.is_mandatory ? "Obligatorio" : "Opcional"}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {s.allowed_results?.length ? s.allowed_results.join(", ") : "Cualquiera"}
                </td>
                <td className="px-5 py-3 text-right">
                  <form action={deleteWorkflowStep}>
                    <input type="hidden" name="step_id" value={s.id} />
                    <input type="hidden" name="workflow_id" value={id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                    >
                      Eliminar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Agregar paso</h2>
        <form action={addWorkflowStep} className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <input type="hidden" name="workflow_id" value={id} />
          <input
            type="text"
            name="name"
            required
            placeholder="Nombre del paso (ej. Primer contacto)"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <input
            type="text"
            name="description"
            placeholder="Descripción (opcional)"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <input
            type="text"
            name="allowed_results"
            placeholder="Resultados permitidos, separados por coma (opcional)"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="is_mandatory" defaultChecked className="rounded border-border" />
            Paso obligatorio
          </label>
          <button
            type="submit"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover sm:justify-self-start"
          >
            Agregar paso
          </button>
        </form>
      </div>
    </div>
  );
}
