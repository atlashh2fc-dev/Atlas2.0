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
import { Badge, Card, SectionCard, buttonClasses } from "@/components/ui";
import type { ReactNode } from "react";

/** Fila etiqueta/valor para las fichas de detalle (dt/dd alineados). */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
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
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-foreground">{lead.full_name}</h1>
            {call && <CallTimer startedAt={call.started_at} endedAt={call.ended_at} />}
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <InfoRow label="RUT">{lead.rut ?? "—"}</InfoRow>
            <InfoRow label="Teléfono">{lead.phone ?? "—"}</InfoRow>
            <InfoRow label="Correo">{lead.email ?? "—"}</InfoRow>
            <InfoRow label="Estado">
              {LEAD_STATUSES.find((s) => s.value === lead.status)?.label ?? lead.status}
            </InfoRow>
            <InfoRow label="Tipificación actual">{lead.tipificacion_actual ?? "—"}</InfoRow>
            {lead.next_action_at && (
              <InfoRow label="Próxima agenda">
                {new Date(lead.next_action_at).toLocaleString("es-CL")}
              </InfoRow>
            )}
          </dl>
        </Card>

        <Card>
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
                {contact.is_valid === false && <Badge tone="danger">inválido</Badge>}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Campaña y flujo</h2>
          <dl className="space-y-2 text-sm">
            <InfoRow label="Campaña">{campaign?.name ?? "Sin campaña"}</InfoRow>
            <InfoRow label="Flujo">{workflow?.name ?? "Equifax"}</InfoRow>
          </dl>
        </Card>

        <SectionCard title="Historial de gestiones">
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
        </SectionCard>
      </div>

      {isSupervisorView && (
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-foreground">Vista de supervisión</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Puedes revisar contexto, historial y prioridad del lead. La llamada la cierra el ejecutivo asignado.
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <InfoRow label="Asignado a">{assignedProfile?.full_name ?? "Sin asignar"}</InfoRow>
              <InfoRow label="Estado workflow">{lead.workflow_status ?? "—"}</InfoRow>
              <InfoRow label="Última gestión">
                {lead.managed_at ? new Date(lead.managed_at).toLocaleString("es-CL") : "—"}
              </InfoRow>
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-foreground">Acciones rápidas</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <Link href="/dashboard/team" className={buttonClasses({ className: "w-full" })}>
                Reasignar en Mi equipo
              </Link>
              <Link
                href="/dashboard/reportes"
                className={buttonClasses({ variant: "secondary", className: "w-full" })}
              >
                Ver rendimiento
              </Link>
              <Link
                href="/dashboard/leads/nuevo"
                className={buttonClasses({ variant: "secondary", className: "w-full" })}
              >
                Nuevo registro
              </Link>
            </div>
          </Card>
        </div>
      )}

      {isAdminView && (
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-foreground">Vista administrativa</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Auditoría del lead, asignación y configuración asociada. La gestión telefónica queda en manos del ejecutivo.
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <InfoRow label="Ejecutivo">{assignedProfile?.full_name ?? "Sin asignar"}</InfoRow>
              <InfoRow label="Equipo">{team?.name ?? "Sin equipo"}</InfoRow>
              <InfoRow label="Campaña">{campaign?.name ?? "Sin campaña"}</InfoRow>
              <InfoRow label="Workflow">{lead.workflow_status ?? "—"}</InfoRow>
              <InfoRow label="Actualizado">{new Date(lead.updated_at).toLocaleString("es-CL")}</InfoRow>
            </dl>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-foreground">Acciones administrativas</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {campaign?.id && (
                <Link
                  href={`/dashboard/admin/campanas/${campaign.id}`}
                  className={buttonClasses({ className: "w-full" })}
                >
                  Abrir campaña
                </Link>
              )}
              <Link
                href="/dashboard/admin/usuarios"
                className={buttonClasses({ variant: "secondary", className: "w-full" })}
              >
                Usuarios y equipos
              </Link>
              <Link
                href="/dashboard/reportes"
                className={buttonClasses({ variant: "secondary", className: "w-full" })}
              >
                Ver reportes
              </Link>
            </div>
          </Card>
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
