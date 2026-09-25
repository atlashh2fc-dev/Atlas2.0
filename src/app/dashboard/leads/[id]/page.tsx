import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { puedeLeerConversaciones } from "@/lib/modules.server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, PencilLine, RefreshCw } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { getLeadSupervisionContext, getOpenCall, getRevisableCall, getSupervisableCall, type LeadSupervisionContext } from "@/app/actions/calls";
import { fetchCampaignAgendaPolicy } from "@/lib/campaign-agenda-policy";
import { AgendaCallButton } from "@/components/agenda-call-button";
import { OFFLINE_CHANNEL_LABEL } from "@/lib/call-management-navigation";
import { LeadPhonesPanel } from "@/components/lead-phones-panel";
import { OfflineManagementButton } from "@/components/offline-management-button";
import { ScreenPopTiming } from "@/components/screen-pop-timing";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CallTimer } from "@/components/call-timer";
import { LeadTimeline, type TimelineEntry } from "@/components/lead-timeline";
import { buildCallReasonCatalogFromWorkflow, getReasonConfig } from "@/lib/call-typification";
import {
  DEBT_EXTRA_KEYS,
  debtAgeTone,
  fetchCampaignVertical,
  formatClp,
  readDebtSnapshot,
} from "@/lib/campaign-vertical";
import { isOutsideBaseLead, leadContactPerson, leadExtraFields } from "@/lib/lead-extra";
import { metricDefinition } from "@/lib/metric-definitions";
import { completeKovacsDemoAssignment } from "@/app/actions/lead-orchestrator";
import type { Call, Campaign, Lead, Profile, Team, Workflow, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { ActionForm, ActionSubmit, Badge, Callout, Card, InfoTooltip, PageHeader, buttonClasses } from "@/components/ui";
import type { ReactNode } from "react";
import { getCampaignAppointmentScheduleUrl } from "@/lib/campaign-appointment-schedules";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { LearningMemoryPanel } from "@/components/learning-memory-panel";
import {
  MailThreadPanel,
  type LeadMailMessage,
  type LeadMailReplyCommand,
} from "@/components/mail-thread-panel";
import { canOperateAssignedConversation } from "@/lib/workspace-permissions";

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

type ExternalReference = {
  id: string;
  external_key: string;
  first_seen_at: string;
  last_seen_at: string;
  integration_sources: { code: string; name: string } | Array<{ code: string; name: string }> | null;
};

type ExternalEvent = {
  id: string;
  event_type: string;
  occurred_at: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
  integration_sources: { code: string; name: string } | Array<{ code: string; name: string }> | null;
};

type WhatsAppTimelineMessage = {
  id: string;
  direction: "inbound" | "outbound";
  text_body: string | null;
  message_type: string;
  provider_timestamp: string | null;
  created_at: string;
  profiles: { full_name: string } | Array<{ full_name: string }> | null;
};

function relationOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function externalEventTitle(event: ExternalEvent) {
  if (event.event_type === "engagement.event.v1") {
    const kind = typeof event.payload?.event_kind === "string" ? event.payload.event_kind : null;
    const clicked = event.payload?.clicked === true || kind === "clicked" || kind === "click";
    const opened = event.payload?.opened === true || kind === "opened" || kind === "open";
    if (clicked) return "Click en correo";
    if (opened) return "Apertura de correo";
    return "Señal de correo recibida";
  }
  if (event.event_type === "intelligence.decision.v1") return "Prioridad externa actualizada";
  return "Evento externo sincronizado";
}

function formatTrackedLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!(url.protocol === "https:" || url.protocol === "http:")) return null;
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

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
  // Se renderiza en el servidor (UTC): sin zona, una agenda de las 09:13 se leía 12:13.
  return date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" });
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tipificar?: string | string[]; corregir?: string | string[]; orquestado?: string | string[]; supervisar?: string | string[] }>;
}) {
  const profile = await requireProfile();
  const permissions = getWorkspacePermissions(profile.role);
  const leeConversaciones = await puedeLeerConversaciones(profile.role);
  const { id } = await params;
  const { corregir, orquestado, supervisar } = await searchParams;
  const correctionRequested = corregir === "1";
  // ?supervisar=<id de gestión> corrige esa gestión; ?supervisar=nueva agrega una.
  const supervisionTarget = typeof supervisar === "string" && supervisar ? supervisar : null;
  const supabase = await createClient();

  const { data: lead360 } = await supabase.rpc("get_lead_360", { p_lead_id: id });
  if (!lead360) notFound();

  const record = lead360 as Lead360;
  const lead = record.lead;
  const campaign = record.campaign;
  const appointmentScheduleUrl = getCampaignAppointmentScheduleUrl(campaign?.name);
  const assignedProfile = record.assigned_profile;
  const team = record.team;
  const contacts = record.contacts ?? [];
  // En cobranza la deuda tiene ficha propia arriba; repetir esas mismas claves
  // en el volcado de la carga solo agrega ruido a la pantalla del ejecutivo.
  const vertical = await fetchCampaignVertical(supabase, lead.campaign_id ?? campaign?.id ?? null);
  const debt = vertical === "cobranza" ? readDebtSnapshot(lead.extra) : null;
  const campaignData = leadExtraFields(lead.extra, { exclude: debt ? DEBT_EXTRA_KEYS : [] });
  const contactPerson = leadContactPerson(lead.extra, lead.full_name);

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
  const equifaxCommercialFieldsEnabled = reasonCatalog.some(
    (reason) => reason.requiresEquifaxData === true
  );
  const agendaPolicy = await fetchCampaignAgendaPolicy(supabase, lead.campaign_id ?? campaign?.id ?? null);

  const [
    { data: externalRefsData },
    { data: externalEventsData },
    { data: whatsAppMessagesData },
    { data: mailMessagesData },
    { data: mailReplyCommandsData },
    { data: saleValidationData },
  ] = await Promise.all([
    supabase
      .from("lead_external_refs")
      .select("id, external_key, first_seen_at, last_seen_at, integration_sources(code, name)")
      .eq("lead_id", id)
      .order("last_seen_at", { ascending: false })
      .limit(8),
    supabase
      .from("external_lead_events")
      .select("id, event_type, occurred_at, created_at, payload, integration_sources(code, name)")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(30),
    leeConversaciones ? supabase
      .from("whatsapp_messages")
      .select("id, direction, text_body, message_type, provider_timestamp, created_at, profiles(full_name), whatsapp_conversations!inner(lead_id)")
      .eq("whatsapp_conversations.lead_id", id)
      .order("provider_timestamp", { ascending: false, nullsFirst: false })
      .limit(30) : Promise.resolve({ data: [] }),
    leeConversaciones ? supabase
      .from("lead_mail_messages")
      .select("id, direction, from_email, to_email, subject, body_text, occurred_at, external_message_id")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true })
      .limit(50) : Promise.resolve({ data: [] }),
    leeConversaciones ? supabase
      .from("mail_reply_commands")
      .select("id, subject, body_text, status, last_error, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(20) : Promise.resolve({ data: [] }),
    // Última venta tipificada del registro y lo que decidió supervisión. La
    // RLS deja al ejecutivo ver solo las suyas.
    supabase
      .from("sale_validations")
      .select("status, decision_note, decision_source, decided_at")
      .eq("lead_id", id)
      .neq("status", "anulada")
      .order("sold_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const saleValidation = saleValidationData as {
    status: "pendiente" | "aprobada" | "rechazada";
    decision_note: string | null;
    decision_source: string | null;
    decided_at: string | null;
  } | null;
  const externalRefs = (externalRefsData ?? []) as ExternalReference[];
  const externalEvents = (externalEventsData ?? []) as ExternalEvent[];
  const whatsAppMessages = (whatsAppMessagesData ?? []) as WhatsAppTimelineMessage[];
  const mailMessages = (mailMessagesData ?? []) as LeadMailMessage[];
  const mailReplyCommands = (mailReplyCommandsData ?? []) as LeadMailReplyCommand[];

  // El render solo consulta una gestión abierta. Crear una llamada aquí provoca
  // duplicados cuando el cierre revalida la página antes de navegar.
  const canManageCall = permissions.canAttendCustomers;
  const canReassign = permissions.canManageAssignments;
  const canOperateAssigned = canOperateAssignedConversation(profile, lead.assigned_to);
  // Sin asignación, el cliente es de quien lo gestionó (mismo criterio que
  // begin_agent_assigned_lead_call). Los clientes migrados de Atlas 1 llegaron
  // sin assigned_to y el ejecutivo no tenía cómo llamar a los suyos. Tiene que
  // seguir en la campaña del registro.
  const ownsManagedRecord = canManageCall
    && profile.active
    && lead.assigned_to === null
    && lead.managed_by === profile.id
    && Boolean(lead.campaign_id)
    && Boolean(
      (
        await supabase
          .from("campaign_agents")
          .select("campaign_id")
          .eq("profile_id", profile.id)
          .eq("campaign_id", lead.campaign_id!)
          .maybeSingle()
      ).data,
    );
  const call = canManageCall ? await getOpenCall(id) : null;
  const revisableCall =
    canManageCall && !call && lead.managed_by === profile.id
      ? await getRevisableCall(id)
      : null;

  // Supervisión corrige o agrega tipificaciones (p. ej. una venta que el
  // ejecutivo no marcó como venta). Fuera de su alcance la RPC falla y el
  // panel simplemente no aparece.
  let supervisionContext: LeadSupervisionContext | null = null;
  if (profile.role === "supervisor" || profile.role === "admin") {
    try {
      supervisionContext = await getLeadSupervisionContext(id);
    } catch {
      supervisionContext = null;
    }
  }
  const supervisedCall: Call | null =
    supervisionContext && supervisionTarget
      ? supervisionTarget === "nueva"
        ? ({
            id: "",
            lead_id: lead.id,
            agent_id: supervisionContext.defaultAgentId ?? "",
            status: null,
            outcome: null,
            reason: null,
            notes: null,
            next_action_at: null,
            next_action_window: null,
            callback_owner_user_id: null,
            equifax_products: null,
            equifax_uf_amount: null,
            equifax_recipient_email: null,
            phone_status: null,
            started_at: new Date().toISOString(),
            ended_at: null,
            discarded_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } satisfies Call)
        : await getSupervisableCall(lead.id, supervisionTarget)
      : null;

  const entries: TimelineEntry[] = [
    ...(record.timeline ?? []).map((item): TimelineEntry => ({
    key: `${item.source}-${item.id}`,
    source: item.source,
    date: item.occurred_at,
    title: getReasonConfig(item.title)?.label ?? item.title ?? "Gestión",
    notes: item.notes,
    agenda: item.next_action_at,
    agent: item.agent_name,
    })),
    ...externalEvents.map((event): TimelineEntry => {
      const source = relationOne(event.integration_sources);
      const bucket = typeof event.payload?.bucket === "string" ? event.payload.bucket : null;
      const message = typeof event.payload?.message_subject === "string"
        ? event.payload.message_subject
        : typeof event.payload?.message_id === "string"
          ? `Mensaje ${event.payload.message_id}`
          : null;
      const link = formatTrackedLink(event.payload?.link_url);
      const notes = [
        message,
        link ? `Enlace: ${link}` : null,
        bucket ? `Clasificación: ${bucket}` : null,
      ].filter(Boolean).join(" · ");
      return {
        key: `integration-${event.id}`,
        source: event.event_type === "engagement.event.v1" ? "email" : "integration",
        date: event.occurred_at ?? event.created_at,
        title: externalEventTitle(event),
        notes: notes || null,
        agenda: null,
        agent: source?.name ?? source?.code ?? "Integración",
      };
    }),
    ...whatsAppMessages.map((message): TimelineEntry => {
      const sender = relationOne(message.profiles);
      const inbound = message.direction === "inbound";
      return {
        key: `whatsapp-${message.id}`,
        source: "whatsapp",
        date: message.provider_timestamp ?? message.created_at,
        title: inbound ? "WhatsApp recibido" : "WhatsApp enviado",
        notes: message.text_body || `[${message.message_type}]`,
        agenda: null,
        agent: inbound ? lead.full_name : sender?.full_name ?? "Equipo Atlas",
      };
    }),
  ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

  const statusLabel = LEAD_STATUSES.find((status) => status.value === lead.status)?.label ?? lead.status;
  const overdue = lead.next_action_at ? new Date(lead.next_action_at).getTime() <= new Date().getTime() : false;
  // Mismo dueño que usan el discador y begin_agent_agenda_callback. Las 447
  // agendas migradas de Equifax tienen managed_by pero assigned_to vacío, así
  // que exigir la asignación dejaba al ejecutivo sin botón en su propia ficha.
  const ownsAgenda = Boolean(lead.next_action_at)
    && profile.role === "agente"
    && (lead.managed_by ?? lead.assigned_to) === profile.id;

  const contactCard = (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-foreground">Datos de contacto</h2>
      <dl className="space-y-2 text-sm">
        {contactPerson && <InfoRow label="Contacto">{contactPerson}</InfoRow>}
        <InfoRow label="RUT">{lead.rut ?? "—"}</InfoRow>
        <InfoRow label="Teléfono">{lead.phone ?? "—"}</InfoRow>
        <InfoRow label="Correo">{lead.email ?? "—"}</InfoRow>
      </dl>

      {/* Teléfonos en el orden en que se llaman; supervisión agrega los
          que están fuera de base y elige el principal. */}
      <LeadPhonesPanel
        leadId={lead.id}
        canManage={profile.role === "admin" || profile.role === "supervisor"}
      />

      {contacts.some((contact) => contact.contact_type !== "phone") && (
        <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
          {contacts.filter((contact) => contact.contact_type !== "phone").map((contact) => (
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
  );

  function renderDebt(compact: boolean) {
    if (!debt) return null;
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Estado de la deuda</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Saldo, mora y contexto del alumno con los que se negocia esta gestión.
            </p>
          </div>
          {debt.estado && (
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {debt.estado}
            </span>
          )}
        </div>
        <dl className={compact ? "grid grid-cols-2 gap-x-6 gap-y-3" : "grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4"}>
          <div className="min-w-0 border-b border-border/70 pb-2">
            <dt className="text-xs font-medium text-muted-foreground">Saldo pendiente</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {formatClp(debt.monto)}
            </dd>
            {debt.montoUf !== null && (
              <dd className="text-xs text-muted-foreground">{debt.montoUf} UF</dd>
            )}
          </div>
          <div className="min-w-0 border-b border-border/70 pb-2">
            <dt className="text-xs font-medium text-muted-foreground">Mora</dt>
            <dd
              className={`mt-0.5 text-sm font-medium ${
                debtAgeTone(debt.diasMora) === "danger"
                  ? "text-danger"
                  : debtAgeTone(debt.diasMora) === "warning"
                    ? "text-warning"
                    : "text-foreground"
              }`}
            >
              {debt.diasMora !== null ? `${debt.diasMora} días` : "Sin informar"}
            </dd>
            {debt.tramo && <dd className="text-xs text-muted-foreground">{debt.tramo}</dd>}
          </div>
          <div className="min-w-0 border-b border-border/70 pb-2">
            <dt className="text-xs font-medium text-muted-foreground">Cuotas impagas</dt>
            <dd className="mt-0.5 text-sm text-foreground">{debt.cuotas ?? "—"}</dd>
            {debt.tipo && <dd className="text-xs text-muted-foreground">{debt.tipo}</dd>}
          </div>
          <div className="min-w-0 border-b border-border/70 pb-2">
            <dt className="text-xs font-medium text-muted-foreground">Vencimiento más antiguo</dt>
            <dd className="mt-0.5 text-sm text-foreground">{debt.vencimiento ?? "—"}</dd>
          </div>
          {debt.alumno && (
            <div className="min-w-0 border-b border-border/70 pb-2">
              <dt className="text-xs font-medium text-muted-foreground">Alumno</dt>
              <dd className="mt-0.5 text-sm text-foreground">{debt.alumno}</dd>
              {debt.curso && <dd className="text-xs text-muted-foreground">{debt.curso}</dd>}
            </div>
          )}
          {debt.sede && (
            <div className="min-w-0 border-b border-border/70 pb-2">
              <dt className="text-xs font-medium text-muted-foreground">Sede</dt>
              <dd className="mt-0.5 text-sm text-foreground">{debt.sede}</dd>
            </div>
          )}
        </dl>
      </section>
    );
  }

  function renderCampaignData(compact: boolean) {
    return (
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
        <dl className={compact ? "grid grid-cols-2 gap-x-6 gap-y-3" : "grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"}>
          {campaignData.map(([key, value], index) => (
            <div key={`${key}-${index}`} className="min-w-0 border-b border-border/70 pb-2">
              <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
              <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

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
            {contactPerson && (
              <span className="text-sm font-semibold text-foreground">Contacto: {contactPerson}</span>
            )}
            <Badge tone="neutral">{statusLabel}</Badge>
            {isOutsideBaseLead(lead.extra) && <Badge tone="info">Fuera de base</Badge>}
            {campaign?.name && <span className="text-sm text-muted-foreground">{campaign.name}</span>}
            {lead.tipificacion_actual && (
              <span className="text-sm text-muted-foreground">· {lead.tipificacion_actual}</span>
            )}
          </span>
        }
        className="border-b-0 pb-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Con la llamada al aire el cronómetro está en la barra del teléfono. */}
            {call && (
              <span className="cti-hide-in-call">
                <CallTimer startedAt={call.started_at} endedAt={call.ended_at} />
              </span>
            )}
            {/* Sin gestión abierta, un compromiso propio se puede marcar desde
                aquí aunque la campaña sea automática: el discador solo entrega
                el callback dentro de su ventana y después queda incallable. */}
            {canManageCall && !call && (canOperateAssigned || ownsManagedRecord || ownsAgenda) && lead.phone && (
              <AgendaCallButton
                leadId={lead.id}
                fullName={lead.full_name}
                variant="secondary"
                label={lead.next_action_at && overdue ? "Llamar compromiso vencido" : "Llamar ahora"}
                // Con agenda propia se abre como agenda: queda tomada y el
                // discador ya no la marca en paralelo ni después.
                source={ownsAgenda ? "agenda" : "assigned_lead"}
              />
            )}
            {/* Contacto por otro canal (WhatsApp propio, correo, presencial):
                se tipifica sin volver a llamar. */}
            {profile.role === "agente" && canManageCall && !call &&
              (lead.managed_by === profile.id || lead.assigned_to === profile.id) && (
              <OfflineManagementButton leadId={lead.id} />
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
              <Link href={profile.role === "admin" ? `/dashboard/leads?q=${encodeURIComponent(lead.rut ?? lead.phone ?? lead.full_name)}` : "/dashboard/team"} className={buttonClasses({ variant: "secondary" })}>
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

      {!permissions.canAttendCustomers && (
        <Callout tone="info">
          Vista de consulta y control. La atención y la tipificación pertenecen al ejecutivo responsable.
          {!leeConversaciones && " El contenido de las conversaciones WhatsApp no se consulta desde Administración."}
        </Callout>
      )}

      {profile.role !== "agente" && <LearningMemoryPanel leadId={lead.id} />}

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

      {saleValidation && (
        <Callout tone={saleValidation.status === "aprobada" ? "success" : saleValidation.status === "rechazada" ? "danger" : "warning"}>
          {saleValidation.status === "pendiente" && "Venta en validación: espera la revisión de supervisión antes de avanzar."}
          {saleValidation.status === "aprobada" &&
            (saleValidation.decision_source === "atlas1"
              ? "Venta validada en Atlas 1."
              : `Venta aprobada por supervisión${saleValidation.decision_note ? `: ${saleValidation.decision_note}` : "."}`)}
          {saleValidation.status === "rechazada" && `Venta rechazada por supervisión: ${saleValidation.decision_note}`}
          {profile.role !== "agente" && (
            <Link href="/dashboard/validacion-ventas" className="ml-2 font-medium underline">
              Ir a validación de ventas
            </Link>
          )}
        </Callout>
      )}

      {supervisionContext && (
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Supervisión de la gestión</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Corrige una tipificación o agrega la última. Una venta que no se marcó como tal entra a la
                validación de ventas al dejarla como VENTA EN VALIDACION.
              </p>
            </div>
            <Link
              href={`/dashboard/leads/${lead.id}?supervisar=nueva#supervision-form`}
              className={buttonClasses({ variant: supervisionTarget === "nueva" ? "primary" : "secondary", size: "sm" })}
            >
              Agregar tipificación
            </Link>
          </div>
          {supervisionContext.managements.length === 0 ? (
            <p className="text-xs text-muted-foreground">Este registro no tiene gestiones tipificadas.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {supervisionContext.managements.map((management) => (
                <li key={management.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{management.reason ?? "Sin tipificación"}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        new Date(management.endedAt).toLocaleString("es-CL", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Santiago",
                        }),
                        management.agentName,
                        management.channel === "supervision" ? "Registrada por supervisión" : null,
                        management.fromAtlas1 ? "Atlas 1" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {management.fromAtlas1 ? (
                    <span className="text-xs text-muted-foreground" title="El historial de Atlas 1 no se reescribe: agrega una tipificación nueva.">
                      No se corrige
                    </span>
                  ) : (
                    <Link
                      href={`/dashboard/leads/${lead.id}?supervisar=${management.id}#supervision-form`}
                      className={buttonClasses({ variant: supervisionTarget === management.id ? "primary" : "ghost", size: "sm" })}
                    >
                      <PencilLine size={13} />
                      Corregir
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {supervisionContext && supervisionTarget && !supervisedCall && (
        <Callout tone="warning">No se encontró esa gestión, o fue descartada.</Callout>
      )}

      {supervisionContext && supervisedCall && (
        <section id="supervision-form" className="rounded-2xl border-2 border-warning/20 bg-warning/[0.025] p-3 sm:p-5">
          <CallTypificationForm
            key={supervisedCall.id || "nueva"}
            lead={lead}
            call={supervisedCall}
            reasonCatalog={reasonCatalog}
            equifaxCommercialFieldsEnabled={equifaxCommercialFieldsEnabled}
            appointmentScheduleUrl={appointmentScheduleUrl}
            agendaPolicy={agendaPolicy}
            supervision={{
              callId: supervisionTarget === "nueva" ? null : supervisedCall.id,
              agents: supervisionContext.agents,
              defaultAgentId: supervisionContext.defaultAgentId,
            }}
          />
        </section>
      )}

      {orquestado === "1" && !orchestratorAssignment && campaign?.name === "Kovacs" && (
        <Callout tone="warning">Esta entrega demo ya fue cerrada o liberada. Espera la siguiente asignación del motor.</Callout>
      )}

      {call && (
        // Durante la gestión: el formulario a la izquierda y el cliente a la
        // derecha, una sola vez. El teléfono ya no repite estos datos.
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] xl:items-start">
          <section
            id="gestion-en-curso"
            className="min-w-0 scroll-mt-4 rounded-2xl border-2 border-primary/20 bg-primary/[0.025] p-3 sm:p-5"
          >
            {/* Cierra la medición de cuánto tardó la ficha en aparecer. */}
            {profile.role === "agente" && <ScreenPopTiming leadId={lead.id} />}
            {call.management_channel && (
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-foreground">
                Gestión sin llamada · {OFFLINE_CHANNEL_LABEL[call.management_channel] ?? "Otro canal"}
              </p>
            )}
            <CallTypificationForm
              key={call.id}
              lead={lead}
              call={call}
              reasonCatalog={reasonCatalog}
              equifaxCommercialFieldsEnabled={equifaxCommercialFieldsEnabled}
              appointmentScheduleUrl={appointmentScheduleUrl}
              agendaPolicy={agendaPolicy}
            />
          </section>
          <aside className="space-y-4 xl:sticky xl:top-0" aria-label="Datos del cliente">
            {contactCard}
            {debt && renderDebt(true)}
            {campaignData.length > 0 && renderCampaignData(true)}
          </aside>
        </div>
      )}

      {!call && revisableCall && correctionRequested && (
        <section className="rounded-2xl border-2 border-warning/20 bg-warning/[0.025] p-3 sm:p-5">
          <CallTypificationForm
            key={revisableCall.id}
            lead={lead}
            call={revisableCall}
            reasonCatalog={reasonCatalog}
            equifaxCommercialFieldsEnabled={equifaxCommercialFieldsEnabled}
            appointmentScheduleUrl={appointmentScheduleUrl}
            agendaPolicy={agendaPolicy}
            revision
          />
        </section>
      )}

      {!call && debt && renderDebt(false)}

      {!call && campaignData.length > 0 && renderCampaignData(false)}

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
        {/* Zona 1: identidad y contexto */}
        <aside className="space-y-4">
          {!call && contactCard}

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

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <RefreshCw size={15} className="text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Sincronización 360</h2>
            </div>
            {externalRefs.length ? (
              <div className="space-y-3">
                {externalRefs.map((reference) => {
                  const source = relationOne(reference.integration_sources);
                  return (
                    <div key={reference.id} className="border-b border-border/70 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{source?.name ?? source?.code ?? "Externo"}</span>
                        <Badge tone="success">Sincronizado</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={reference.external_key}>
                        {reference.external_key}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Última señal {formatDateTime(reference.last_seen_at)}
                      </p>
                    </div>
                  );
                })}
                {profile.role !== "agente" && (
                  <Link href="/dashboard/admin/integraciones/historial" className="text-xs font-medium text-primary hover:underline">
                    Ver historial de integración
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin referencias externas para este registro.</p>
            )}
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

          <MailThreadPanel
            leadId={lead.id}
            messages={mailMessages}
            commands={mailReplyCommands}
            canReply={canOperateAssigned}
          />

          <LeadTimeline entries={entries} />
        </main>
      </div>
    </div>
  );
}
