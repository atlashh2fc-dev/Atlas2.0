import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound } from "next/navigation";
import { LEAD_STATUSES, INTERACTION_RESULTS } from "@/lib/types";
import { registerInteraction } from "@/app/actions/leads";
import { assignLeadWorkflow } from "@/app/actions/workflows";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) notFound();

  const { data: interactions } = await supabase
    .from("interactions")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  const { data: progress } = await supabase
    .from("lead_workflow_progress")
    .select("*")
    .eq("lead_id", id)
    .maybeSingle();

  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const resultOptions: string[] =
    progress?.next_step_allowed_results && progress.next_step_allowed_results.length > 0
      ? progress.next_step_allowed_results
      : [...INTERACTION_RESULTS];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-1">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold text-foreground">{lead.full_name}</h1>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">RUT</dt>
              <dd className="text-foreground">{lead.rut ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="text-foreground">{lead.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Correo</dt>
              <dd className="text-foreground">{lead.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Estado</dt>
              <dd className="text-foreground">
                {LEAD_STATUSES.find((s) => s.value === lead.status)?.label ?? lead.status}
              </dd>
            </div>
          </dl>
        </div>

        {(profile.role === "admin" || profile.role === "supervisor") && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Flujo de gestión</h2>
            <form action={assignLeadWorkflow} className="flex items-center gap-2">
              <input type="hidden" name="lead_id" value={lead.id} />
              <select
                name="workflow_id"
                defaultValue={lead.workflow_id ?? ""}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Sin flujo asignado</option>
                {(workflows ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Asignar
              </button>
            </form>
          </div>
        )}

        {lead.workflow_id && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Avance del flujo</h2>
            {progress?.total_mandatory_steps ? (
              <>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (progress.completed_mandatory_steps / progress.total_mandatory_steps) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {progress.completed_mandatory_steps} de {progress.total_mandatory_steps} pasos obligatorios completados
                </p>
                {progress.is_compliant ? (
                  <p className="mt-2 text-xs font-medium text-success">Flujo completado ✓</p>
                ) : (
                  <p className="mt-2 text-xs font-medium text-warning">
                    Pendiente: {progress.next_step_name}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Este flujo no tiene pasos configurados.</p>
            )}
          </div>
        )}

        <form action={registerInteraction} className="rounded-xl border border-border bg-surface p-5">
          <input type="hidden" name="lead_id" value={lead.id} />
          {progress?.next_step_id && !progress.is_compliant && (
            <input type="hidden" name="workflow_step_id" value={progress.next_step_id} />
          )}
          <h2 className="mb-3 text-sm font-semibold text-foreground">Registrar gestión</h2>
          {progress?.next_step_id && !progress.is_compliant && (
            <p className="mb-3 rounded-lg bg-warning-bg px-3 py-2 text-xs font-medium text-warning">
              Completando paso obligatorio: {progress.next_step_name}
            </p>
          )}

          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Resultado</label>
              <select
                name="result"
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {resultOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nuevo estado del lead</label>
              <select
                name="new_status"
                defaultValue=""
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Mantener estado actual</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Notas</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Detalle de la conversación..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Guardar gestión
            </button>
          </div>
        </form>
      </div>

      <div className="lg:col-span-2">
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Historial de gestiones</h2>
          </div>
          <ul className="divide-y divide-border">
            {(interactions ?? []).length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                Sin gestiones registradas todavía.
              </li>
            )}
            {(interactions ?? []).map((i) => (
              <li key={i.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{i.result}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(i.created_at).toLocaleString("es-CL")}
                  </span>
                </div>
                {i.notes && <p className="mt-1 text-sm text-muted-foreground">{i.notes}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
