import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound } from "next/navigation";
import { LEAD_STATUSES, INTERACTION_RESULTS } from "@/lib/types";
import { registerInteraction } from "@/app/actions/leads";
import { assignLeadWorkflow } from "@/app/actions/workflows";
import { getOrCreateOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;

function agentName(value: ProfileEmbed): string {
  const profile = Array.isArray(value) ? value[0] : value;
  return profile?.full_name ?? "—";
}

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

  // Solo agentes (y admin) pueden abrir/crear una llamada: la política RLS de
  // `calls` no permite INSERT a supervisores, así que para ellos esta ficha
  // es de solo lectura y nunca se intenta crear una llamada en su nombre.
  const canManageCall = profile.role === "agente" || profile.role === "admin";
  const call = canManageCall ? await getOrCreateOpenCall(id) : null;

  const { data: previousCalls } = await supabase
    .from("calls")
    .select("*, profiles!calls_agent_id_fkey(full_name)")
    .eq("lead_id", id)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(10);

  const { data: interactions } = await supabase
    .from("interactions")
    .select("*, profiles!interactions_agent_id_fkey(full_name)")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

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

  const hasActiveStep = Boolean(progress?.next_step_id) && !progress?.is_compliant;
  const activeFieldType = hasActiveStep ? progress?.next_step_field_type : null;
  const activeOptions: string[] =
    progress?.next_step_options && progress.next_step_options.length > 0
      ? progress.next_step_options
      : progress?.next_step_allowed_results && progress.next_step_allowed_results.length > 0
        ? progress.next_step_allowed_results
        : [...INTERACTION_RESULTS];

  // Historial combinado: llamadas cerradas + gestiones registradas, orden cronológico descendente.
  const history = [
    ...(previousCalls ?? []).map((c) => ({
      key: `call-${c.id}`,
      date: c.ended_at,
      title: c.outcome ?? c.reason ?? "Llamada",
      notes: c.notes,
      agenda: c.next_action_at,
      agent: agentName(c.profiles as ProfileEmbed),
    })),
    ...(interactions ?? []).map((i) => ({
      key: `interaction-${i.id}`,
      date: i.created_at,
      title: i.result,
      notes: i.notes,
      agenda: null as string | null,
      agent: agentName(i.profiles as ProfileEmbed),
    })),
  ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Cliente, flujo, paso obligatorio e historial */}
      <div className={`space-y-6 ${call ? "lg:col-span-1" : "lg:col-span-3"}`}>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold text-foreground">{lead.full_name}</h1>
            {call && <CallTimer startedAt={call.started_at} endedAt={call.ended_at} />}
          </div>
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
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tipificación actual</dt>
              <dd className="text-foreground">{lead.tipificacion_actual ?? "—"}</dd>
            </div>
            {lead.next_action_at && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Próxima agenda</dt>
                <dd className="text-foreground">{new Date(lead.next_action_at).toLocaleString("es-CL")}</dd>
              </div>
            )}
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

        {canManageCall && hasActiveStep && (
          <form action={registerInteraction} className="rounded-xl border border-border bg-surface p-5">
            <input type="hidden" name="lead_id" value={lead.id} />
            <input type="hidden" name="workflow_step_id" value={progress!.next_step_id!} />
            <h2 className="mb-3 text-sm font-semibold text-foreground">Paso obligatorio del flujo</h2>
            <p className="mb-3 rounded-lg bg-warning-bg px-3 py-2 text-xs font-medium text-warning">
              Completando: {progress!.next_step_name}
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Resultado</label>

                {activeFieldType === "single_choice" && (
                  <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                    {activeOptions.map((opt, i) => (
                      <label key={opt} className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="radio"
                          name="result"
                          value={opt}
                          required
                          defaultChecked={i === 0}
                          className="border-border"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}

                {activeFieldType === "multi_select" && (
                  <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                    {activeOptions.map((opt) => (
                      <label key={opt} className="flex items-center gap-2 text-sm text-foreground">
                        <input type="checkbox" name="result" value={opt} className="rounded border-border" />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}

                {activeFieldType === "text" && (
                  <input
                    type="text"
                    name="result"
                    required
                    placeholder="Escribe la respuesta del cliente..."
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}

                {(activeFieldType === "combobox" || !activeFieldType) && (
                  <select
                    name="result"
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {activeOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
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
                  rows={2}
                  placeholder="Detalle de la conversación..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Guardar gestión del paso
              </button>
            </div>
          </form>
        )}

        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Historial de gestiones</h2>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {history.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-muted-foreground">Sin gestiones registradas todavía.</li>
            )}
            {history.map((h) => (
              <li key={h.key} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{h.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {h.date ? new Date(h.date).toLocaleString("es-CL") : "—"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">Gestionado por: {h.agent}</p>
                {h.notes && <p className="mt-1 text-sm text-muted-foreground">{h.notes}</p>}
                {h.agenda && (
                  <p className="mt-1 text-xs text-accent-foreground">
                    Agenda: {new Date(h.agenda).toLocaleString("es-CL")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Tipificación de la llamada */}
      {call && (
        <div className="lg:col-span-2">
          <CallTypificationForm lead={lead} call={call} />
        </div>
      )}
    </div>
  );
}
