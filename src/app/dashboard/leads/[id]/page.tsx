import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { getOrCreateOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";
import { LeadTimeline, type TimelineEntry } from "@/components/lead-timeline";
import { buildCallReasonCatalogFromWorkflow, getReasonConfig } from "@/lib/call-typification";
import { metricDefinition } from "@/lib/metric-definitions";
import type { Campaign, Lead, Profile, Team, Workflow, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { Badge, Card, InfoTooltip, PageHeader, buttonClasses } from "@/components/ui";
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

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const campaignData = Object.entries(lead.extra ?? {}).filter(
    ([key, value]) =>
      key.toLowerCase() !== "source" &&
      !key.startsWith("_") &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );

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

  // Solo los ejecutivos pueden abrir una llamada: la política RLS de `calls` no
  // permite INSERT a supervisión, así que para ellos la ficha es de lectura.
  const canManageCall = profile.role === "agente";
  const canReassign = profile.role === "supervisor" || profile.role === "admin";
  const call = canManageCall ? await getOrCreateOpenCall(id) : null;

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

          {campaignData.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-foreground">Datos de la base</h2>
              <dl className="space-y-2 text-sm">
                {campaignData.map(([key, value]) => (
                  <InfoRow key={key} label={key}>
                    {String(value)}
                  </InfoRow>
                ))}
              </dl>
            </Card>
          )}
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

          {call && <CallTypificationForm lead={lead} call={call} reasonCatalog={reasonCatalog} />}

          <LeadTimeline entries={entries} />
        </main>
      </div>
    </div>
  );
}
