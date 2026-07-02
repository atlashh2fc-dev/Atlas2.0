import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/types";
import { getOrCreateOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";
import { buildCallReasonCatalogFromWorkflow, getReasonConfig } from "@/lib/call-typification";
import type { WorkflowStep, WorkflowStepBranch } from "@/lib/types";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * El nombre del ejecutivo que gestionó: para registros migrados del CRM legado
 * (historical_agent_id) usamos el nombre guardado en `historical_agents`, ya que
 * `agent_id` en esos casos apunta a un perfil placeholder ("Migración Histórica").
 */
function agentName(profileEmbed: ProfileEmbed, historicalEmbed: ProfileEmbed): string {
  const historical = one(historicalEmbed);
  if (historical) return historical.full_name;
  const profile = one(profileEmbed);
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

  const { data: campaign } = lead.campaign_id
    ? await supabase.from("campaigns").select("id, name, workflow_id").eq("id", lead.campaign_id).maybeSingle()
    : { data: null };
  const [{ data: assignedProfile }, { data: team }] = await Promise.all([
    lead.assigned_to
      ? supabase.from("profiles").select("id, full_name, email").eq("id", lead.assigned_to).maybeSingle()
      : { data: null },
    lead.team_id
      ? supabase.from("teams").select("id, name").eq("id", lead.team_id).maybeSingle()
      : { data: null },
  ]);

  const effectiveWorkflowId = lead.workflow_id ?? campaign?.workflow_id ?? null;
  const { data: workflow } = effectiveWorkflowId
    ? await supabase.from("workflows").select("id, name").eq("id", effectiveWorkflowId).maybeSingle()
    : { data: null };
  const [{ data: workflowSteps }, { data: workflowBranches }] = effectiveWorkflowId
    ? await Promise.all([
        supabase
          .from("workflow_steps")
          .select("*")
          .eq("workflow_id", effectiveWorkflowId)
          .order("step_order", { ascending: true }),
        supabase.from("workflow_step_branches").select("*").eq("workflow_id", effectiveWorkflowId),
      ])
    : [{ data: null }, { data: null }];
  const reasonCatalog = buildCallReasonCatalogFromWorkflow(
    (workflowSteps ?? []) as WorkflowStep[],
    (workflowBranches ?? []) as WorkflowStepBranch[]
  );

  // Solo agentes pueden abrir/crear una llamada: la política RLS de
  // `calls` no permite INSERT a supervisores, así que para ellos esta ficha
  // es de solo lectura y nunca se intenta crear una llamada en su nombre.
  const canManageCall = profile.role === "agente";
  const isSupervisorView = profile.role === "supervisor";
  const isAdminView = profile.role === "admin";
  const call = canManageCall ? await getOrCreateOpenCall(id) : null;

  const { data: previousCalls } = await supabase
    .from("calls")
    .select(
      "*, profiles!calls_agent_id_fkey(full_name), historical_agents!calls_historical_agent_id_fkey(full_name)"
    )
    .eq("lead_id", id)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(10);

  const { data: interactions } = await supabase
    .from("interactions")
    .select(
      "*, profiles!interactions_agent_id_fkey(full_name), historical_agents!interactions_historical_agent_id_fkey(full_name)"
    )
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Historial combinado: llamadas cerradas + gestiones registradas, orden cronológico descendente.
  // Las llamadas migradas del CRM legado no tienen reason/notes propios (el outcome
  // genérico "other" no aporta nada): la tipificación real de esos casos ya queda
  // registrada en su interacción correspondiente, así que esas llamadas vacías se
  // omiten para no duplicar la misma gestión sin información real.
  const history = [
    ...(previousCalls ?? [])
      .filter((c) => c.reason || c.notes)
      .map((c) => ({
        key: `call-${c.id}`,
        date: c.ended_at,
        title: getReasonConfig(c.reason)?.label ?? c.reason ?? "Llamada",
        notes: c.notes,
        agenda: c.next_action_at,
        agent: agentName(c.profiles as ProfileEmbed, c.historical_agents as ProfileEmbed),
      })),
    ...(interactions ?? []).map((i) => ({
      key: `interaction-${i.id}`,
      date: i.created_at,
      title: i.result,
      notes: i.notes,
      agenda: null as string | null,
      agent: agentName(i.profiles as ProfileEmbed, i.historical_agents as ProfileEmbed),
    })),
  ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Cliente, contexto de campana e historial */}
      <div
        className={`space-y-6 ${
          call ? "lg:col-span-1" : isSupervisorView || isAdminView ? "lg:col-span-2" : "lg:col-span-3"
        }`}
      >
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

        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Campaña y flujo</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Campaña</dt>
              <dd className="text-right text-foreground">{campaign?.name ?? "Sin campaña"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Flujo</dt>
              <dd className="text-right text-foreground">{workflow?.name ?? "Equifax"}</dd>
            </div>
          </dl>
        </div>

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

      {isSupervisorView && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Vista de supervisión</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Puedes revisar contexto, historial y prioridad del lead. La llamada la cierra el ejecutivo asignado.
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Asignado a</dt>
                <dd className="text-right text-foreground">
                  {assignedProfile?.full_name ?? "Sin asignar"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Estado workflow</dt>
                <dd className="text-right text-foreground">{lead.workflow_status ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Última gestión</dt>
                <dd className="text-right text-foreground">
                  {lead.managed_at ? new Date(lead.managed_at).toLocaleString("es-CL") : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Acciones rápidas</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <Link
                href="/dashboard/team"
                className="rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Reasignar en Mi equipo
              </Link>
              <Link
                href="/dashboard/reportes"
                className="rounded-lg border border-border bg-background px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Ver rendimiento
              </Link>
              <Link
                href="/dashboard/leads/cargar"
                className="rounded-lg border border-border bg-background px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Cargar nuevos leads
              </Link>
            </div>
          </div>
        </div>
      )}

      {isAdminView && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Vista administrativa</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Auditoría del lead, asignación y configuración asociada. La gestión telefónica queda en manos del ejecutivo.
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Ejecutivo</dt>
                <dd className="text-right text-foreground">{assignedProfile?.full_name ?? "Sin asignar"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Equipo</dt>
                <dd className="text-right text-foreground">{team?.name ?? "Sin equipo"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Campaña</dt>
                <dd className="text-right text-foreground">{campaign?.name ?? "Sin campaña"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Workflow</dt>
                <dd className="text-right text-foreground">{lead.workflow_status ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Actualizado</dt>
                <dd className="text-right text-foreground">{new Date(lead.updated_at).toLocaleString("es-CL")}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Acciones administrativas</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {campaign?.id && (
                <Link
                  href={`/dashboard/admin/campanas/${campaign.id}`}
                  className="rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Abrir campaña
                </Link>
              )}
              <Link
                href="/dashboard/admin/usuarios"
                className="rounded-lg border border-border bg-background px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Usuarios y equipos
              </Link>
              <Link
                href="/dashboard/reportes"
                className="rounded-lg border border-border bg-background px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Ver reportes
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Tipificación de la llamada */}
      {call && (
        <div className="lg:col-span-2">
          <CallTypificationForm lead={lead} call={call} reasonCatalog={reasonCatalog} />
        </div>
      )}
    </div>
  );
}
