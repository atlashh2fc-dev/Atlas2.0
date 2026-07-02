import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/types";
import { getOrCreateOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";
import { buildCallReasonCatalogFromWorkflow, getReasonConfig } from "@/lib/call-typification";
import type { Campaign, Lead, Profile, Team, Workflow, WorkflowStep, WorkflowStepBranch } from "@/lib/types";

type LeadContact = {
  id: string;
  contact_type: "phone" | "email";
  value: string;
  label: string | null;
  is_primary: boolean;
  is_valid: boolean | null;
  source: string;
};

type LeadTimelineItem = {
  source: "call" | "interaction";
  id: string;
  occurred_at: string | null;
  title: string | null;
  notes: string | null;
  next_action_at: string | null;
  agent_name: string;
  metadata: Record<string, unknown>;
};

type Lead360 = {
  lead: Lead;
  contacts: LeadContact[];
  campaign: Pick<Campaign, "id" | "name" | "workflow_id"> | null;
  team: Pick<Team, "id" | "name"> | null;
  assigned_profile: Pick<Profile, "id" | "full_name" | "email"> | null;
  managed_profile: Pick<Profile, "id" | "full_name" | "email"> | null;
  workflow: Pick<Workflow, "id" | "name"> | null;
  summary: {
    timeline_count: number;
    last_activity_at: string | null;
    next_action_at: string | null;
  };
  timeline: LeadTimelineItem[];
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead360 } = await supabase.rpc("get_lead_360", { p_lead_id: id });
  if (!lead360) notFound();

  const record = lead360 as Lead360;
  const lead = record.lead;
  const campaign = record.campaign;
  const assignedProfile = record.assigned_profile;
  const team = record.team;
  const contacts = record.contacts ?? [];

  const effectiveWorkflowId = lead.workflow_id ?? campaign?.workflow_id ?? null;
  const workflow = record.workflow;
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

  const history = (record.timeline ?? []).map((item) => ({
    key: `${item.source}-${item.id}`,
    date: item.occurred_at,
    title: getReasonConfig(item.title)?.label ?? item.title ?? "Gestión",
    notes: item.notes,
    agenda: item.next_action_at,
    agent: item.agent_name,
  }));

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
          <h2 className="mb-3 text-sm font-semibold text-foreground">Contactos</h2>
          <div className="space-y-2 text-sm">
            {contacts.length === 0 && <p className="text-muted-foreground">Sin contactos registrados.</p>}
            {contacts.map((contact) => (
              <div key={contact.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-foreground">{contact.value}</p>
                  <p className="text-xs text-muted-foreground">
                    {contact.contact_type === "phone" ? "Teléfono" : "Correo"}
                    {contact.label ? ` · ${contact.label}` : ""}
                    {contact.is_primary ? " · Principal" : ""}
                  </p>
                </div>
                {contact.is_valid === false && (
                  <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger">
                    inválido
                  </span>
                )}
              </div>
            ))}
          </div>
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
