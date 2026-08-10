import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, PencilLine } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { getOpenCall, getRevisableCall } from "@/app/actions/calls";
import { AgendaCallButton } from "@/components/agenda-call-button";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";
import { LeadTimeline, type TimelineEntry } from "@/components/lead-timeline";
import { buildCallReasonCatalogFromWorkflow, getReasonConfig } from "@/lib/call-typification";
import { metricDefinition } from "@/lib/metric-definitions";
import { completeKovacsDemoAssignment } from "@/app/actions/lead-orchestrator";
import type { Campaign, Lead, Profile, Team, Workflow, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { ActionForm, ActionSubmit, Badge, Callout, Card, InfoTooltip, PageHeader, buttonClasses } from "@/components/ui";
import type { ReactNode } from "react";

/** Fila etiqueta/valor de la columna de identidad. */
function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  );
}

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

/** Los valores técnicos de la etapa del flujo no se muestran crudos. */
const WORKFLOW_STAGE_LABEL: Record<string, string> = {
  pending: "Sin iniciar",
  in_progress: "En gestión",
  managed: "Gestionado",
  completed: "Completado",
  blocked: "Bloqueado",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tipificar?: string | string[]; corregir?: string | string[]; orquestado?: string | string[] }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const { tipificar, corregir, orquestado } = await searchParams;
  const prioritizeTypification = tipificar === "1";
  const correctionRequested = corregir === "1";
  const supabase = await createClient();

  const { data: lead360 } = await supabase.rpc("get_lead_360", { p_lead_id: id });
  if (!lead360) notFound();

  const record = lead360 as Lead360;
  const lead = record.lead;
  const campaign = record.campaign;
  const assignedProfile = record.assigned_profile;
  const team = record.team;
  const contacts = record.contacts ?? [];
  const campaignData = Object.entries(lead.extra ?? {}).filter(
    ([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );

  const { data: orchestratorAssignment } = profile.role === "agente"
    ? await supabase
        .from("lead_orchestrator_assignments")
        .select("id, priority_reason, status, claimed_at")
        .eq("lead_id", id)
        .eq("agent_id", profile.id)
        .in("status", ["delivered", "opened"])
        .maybeSingle()
    : { data: null };

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

  // El render solo consulta una gestión abierta. Crear una llamada aquí provoca
  // duplicados cuando el cierre revalida la página antes de navegar.
  const canManageCall = profile.role === "agente";
  const canReassign = profile.role === "supervisor" || profile.role === "admin";
  const call = canManageCall ? await getOpenCall(id) : null;
  const revisableCall =
    canManageCall && !call && lead.managed_by === profile.id
      ? await getRevisableCall(id)
      : null;

  const entries: TimelineEntry[] = (record.timeline ?? []).map((item) => ({
    key: `${item.source}-${item.id}`,
    source: item.source,
    date: item.occurred_at,
    title: getReasonConfig(item.title)?.label ?? item.title ?? "Gestión",
    notes: item.notes,
    agenda: item.next_action_at,
    agent: item.agent_name,
  }));

  const statusLabel = LEAD_STATUSES.find((status) => status.value === lead.status)?.label ?? lead.status;
  const overdue = lead.next_action_at ? new Date(lead.next_action_at).getTime() <= new Date().getTime() : false;

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/leads"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={13} />
        Registros
      </Link>

      <PageHeader
        title={lead.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{statusLabel}</Badge>
            {campaign?.name && <span className="text-sm text-muted-foreground">{campaign.name}</span>}
            {lead.tipificacion_actual && (
              <span className="text-sm text-muted-foreground">· {lead.tipificacion_actual}</span>
            )}
          </span>
        }
        className="border-b-0 pb-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {call && <CallTimer startedAt={call.started_at} endedAt={call.ended_at} />}
            {/* Sin gestión abierta, un compromiso propio se puede marcar desde
                aquí aunque la campaña sea automática: el discador solo entrega
                el callback dentro de su ventana y después queda incallable. */}
            {canManageCall && !call && lead.next_action_at && lead.managed_by === profile.id && (
              <AgendaCallButton
                leadId={lead.id}
                fullName={lead.full_name}
                variant="secondary"
                label={overdue ? "Llamar compromiso vencido" : "Llamar ahora"}
              />
            )}
            {revisableCall && !correctionRequested && (
              <Link
                href={`/dashboard/leads/${lead.id}?corregir=1`}
                className={buttonClasses({ variant: "secondary" })}
              >
                <PencilLine size={15} />
                Corregir tipificación
              </Link>
            )}
            {canReassign && (
              <Link href="/dashboard/team" className={buttonClasses({ variant: "secondary" })}>
                Reasignar
              </Link>
            )}
            {campaign?.id && profile.role === "admin" && (
              <Link
                href={`/dashboard/admin/campanas/${campaign.id}`}
                className={buttonClasses({ variant: "secondary" })}
              >
                Abrir campaña
              </Link>
            )}
          </div>
        }
      />

      {orchestratorAssignment && (
        <Callout tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">Lead entregado por el motor de priorización</p>
              <p className="mt-1 text-sm">
                Ganó por <strong>{orchestratorAssignment.priority_reason}</strong>. El motor evaluó la base y lo reservó exclusivamente para este ejecutivo.
              </p>
            </div>
            {campaign?.name === "Kovacs" && (
              <ActionForm action={completeKovacsDemoAssignment} success="Demo cerrada; el motor buscará el siguiente lead">
                <input type="hidden" name="lead_id" value={lead.id} />
                <ActionSubmit size="sm" pendingLabel="Cerrando…">Cerrar demo y recibir siguiente</ActionSubmit>
              </ActionForm>
            )}
          </div>
        </Callout>
      )}

      {orquestado === "1" && !orchestratorAssignment && campaign?.name === "Kovacs" && (
        <Callout tone="warning">Esta entrega demo ya fue cerrada o liberada. Espera la siguiente asignación del motor.</Callout>
      )}

      {campaignData.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Datos cargados de la base</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Información disponible para esta gestión.
              </p>
            </div>
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {campaignData.length} campos
            </span>
          </div>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {campaignData.map(([key, value]) => (
              <div key={key} className="min-w-0 border-b border-border/70 pb-2">
                <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
                <dd className="mt-0.5 break-words text-sm text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {call && (
        <section className="rounded-2xl border-2 border-primary/20 bg-primary/[0.025] p-3 sm:p-5">
          <CallTypificationForm
            lead={lead}
            call={call}
            reasonCatalog={reasonCatalog}
            priority={prioritizeTypification}
          />
        </section>
      )}

      {!call && revisableCall && correctionRequested && (
        <section className="rounded-2xl border-2 border-warning/20 bg-warning/[0.025] p-3 sm:p-5">
          <CallTypificationForm
            lead={lead}
            call={revisableCall}
            reasonCatalog={reasonCatalog}
            revision
          />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
        {/* Zona 1: identidad y contexto */}
        <aside className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Datos de contacto</h2>
            <dl className="space-y-2 text-sm">
              <InfoRow label="RUT">{lead.rut ?? "—"}</InfoRow>
              <InfoRow label="Teléfono">{lead.phone ?? "—"}</InfoRow>
              <InfoRow label="Correo">{lead.email ?? "—"}</InfoRow>
            </dl>

            {contacts.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
                {contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{contact.value}</p>
                      <p className="text-xs text-muted-foreground">
                        {contact.contact_type === "phone" ? "Teléfono" : "Correo"}
                        {contact.label ? ` · ${contact.label}` : ""}
                        {contact.is_primary ? " · Principal" : ""}
                      </p>
                    </div>
                    {contact.is_valid === false && <Badge tone="danger">Inválido</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Operación</h2>
            <dl className="space-y-2 text-sm">
              <InfoRow label="Campaña">{campaign?.name ?? "Sin campaña"}</InfoRow>
              <InfoRow label="Flujo de gestión">{workflow?.name ?? "Sin flujo asignado"}</InfoRow>
              <InfoRow
                label={
                  <span className="inline-flex items-center gap-1">
                    {metricDefinition("etapa_flujo").label}
                    <InfoTooltip text={metricDefinition("etapa_flujo").definition} />
                  </span>
                }
              >
                {WORKFLOW_STAGE_LABEL[lead.workflow_status ?? ""] ?? lead.workflow_status ?? "Sin iniciar"}
              </InfoRow>
              {profile.role !== "agente" && (
                <>
                  <InfoRow label="Ejecutivo">{assignedProfile?.full_name ?? "Sin asignar"}</InfoRow>
                  <InfoRow label="Equipo">{team?.name ?? "Sin equipo"}</InfoRow>
                </>
              )}
              <InfoRow label="Última gestión">{formatDateTime(lead.managed_at)}</InfoRow>
              <InfoRow label="Actualizado">{formatDateTime(lead.updated_at)}</InfoRow>
            </dl>
          </Card>

        </aside>

        {/* Zona 2: la acción de ahora y el hilo completo */}
        <main className="space-y-5">
          <Card className={overdue ? "border-danger/40" : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarClock size={16} className={overdue ? "text-danger" : "text-muted-foreground"} />
                <div>
                  <p className="text-xs text-muted-foreground">Próxima acción</p>
                  <p className={`text-sm font-medium ${overdue ? "text-danger" : "text-foreground"}`}>
                    {lead.next_action_at
                      ? `${overdue ? "Vencida · " : ""}${formatDateTime(lead.next_action_at)}`
                      : "Sin agenda"}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {record.summary?.timeline_count ?? entries.length} gestiones registradas
              </p>
            </div>
          </Card>

          <LeadTimeline entries={entries} />
        </main>
      </div>
    </div>
  );
}
