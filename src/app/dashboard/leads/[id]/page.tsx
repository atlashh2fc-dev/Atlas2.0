import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { puedeLeerConversaciones } from "@/lib/modules.server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Contact,
  Database,
  PencilLine,
  Phone,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { getLeadSupervisionContext, getMyOpenManagement, getOpenCall, getRevisableCall, getSupervisableCall, type LeadSupervisionContext } from "@/app/actions/calls";
import { fetchCampaignAgendaPolicy } from "@/lib/campaign-agenda-policy";
import { AgendaCallButton } from "@/components/agenda-call-button";
import { OFFLINE_CHANNEL_LABEL, OPEN_CALL_FORM_ATTRIBUTE } from "@/lib/call-management-navigation";
import { LeadPhonesPanel } from "@/components/lead-phones-panel";
import { LeadReassignPanel } from "@/components/lead-reassign-panel";
import { OfflineManagementButton } from "@/components/offline-management-button";
import { ScreenPopTiming } from "@/components/screen-pop-timing";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CotizadorEquifax } from "@/components/cotizador-equifax";
import { CorreoRegistroPanel, type CorreoEnviado, type CorreoRecibido } from "@/components/correo-registro-panel";
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
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, InfoTooltip, StatusDot, buttonClasses } from "@/components/ui";
import {
  CountBox,
  Property,
  PropertyGroup,
  PropertyList,
  RecordFact,
  RecordFacts,
  RecordHeader,
  StateChip,
  dateTimeLabel,
  relativeLabel,
  sentenceCase,
  type ChipTone,
} from "@/components/record-kit";
import type { ComponentType } from "react";
import { getCampaignAppointmentScheduleUrl } from "@/lib/campaign-appointment-schedules";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { LearningMemoryPanel } from "@/components/learning-memory-panel";
import {
  MailThreadPanel,
  type LeadMailMessage,
  type LeadMailReplyCommand,
} from "@/components/mail-thread-panel";
import { canOperateAssignedConversation } from "@/lib/workspace-permissions";

/** Estado operativo de la ficha: el mismo vocabulario que la cola de Registros. */
type OperationalState = {
  label: string;
  icon: ComponentType<{ size?: number }>;
  tone: ChipTone;
  danger?: boolean;
};

/** Mismo día del calendario en Chile (no en UTC). */
function sameChileDay(a: Date, b: Date) {
  const key = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  return key(a) === key(b);
}

/** Clase de la columna lateral: un panel, grupos separados por una línea. */
const SIDE_PANEL = "atlas-panel divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm";

type EquifaxQuoteRow = {
  id: string;
  canal: "correo" | "whatsapp";
  destinatario: string;
  productos: string[] | null;
  uf_mensual: number | string;
  uf_unico: number | string;
  uf_anual: number | string;
  clp_total: number | string;
  estado: "enviando" | "enviada" | "fallida" | "whatsapp_abierto";
  error: string | null;
  created_at: string;
  profiles: { full_name: string } | { full_name: string }[] | null;
};

function formatUfAmount(value: number): string {
  return value.toLocaleString("es-CL", { maximumFractionDigits: 2 });
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

  const { data: lead360, error: lead360Error } = await supabase.rpc("get_lead_360", { p_lead_id: id });
  // Un fallo de la base no es "este registro no existe": se lanza para que lo
  // muestre error.tsx con su reintento, en vez de un 404 que confunde.
  if (lead360Error) {
    console.error("No se pudo leer la ficha 360 del registro", { leadId: id, error: lead360Error });
    throw new Error("No se pudo abrir la ficha del registro. Actualiza la página; si sigue igual, avisa a tu supervisor.");
  }
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
    { data: quotesData },
    { data: saleValidationData },
    { data: correosRecibidosData },
    { data: correosEnviadosData },
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
    equifaxCommercialFieldsEnabled ? supabase
      .from("equifax_cotizaciones")
      .select("id, canal, destinatario, productos, uf_mensual, uf_unico, uf_anual, clp_total, estado, error, created_at, profiles!equifax_cotizaciones_agent_id_fkey(full_name)")
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
    // Respuestas al buzón de la cuenta y lo que se les contestó desde acá. La
    // RLS deja al ejecutivo ver las suyas y las de sus registros.
    supabase
      .from("inbound_emails")
      .select("id, from_name, from_address, subject, body_text, received_at, status, asignacion, profiles!inbound_emails_assigned_to_fkey(full_name)")
      .eq("lead_id", id)
      .order("received_at", { ascending: true })
      .limit(30),
    supabase
      .from("correos_de_registro")
      .select("id, respuesta_a, destinatario, asunto, cuerpo, estado, error, created_at, profiles!correos_de_registro_agent_id_fkey(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: true })
      .limit(30),
  ]);
  const correosRecibidos = (correosRecibidosData ?? []) as unknown as CorreoRecibido[];
  const correosEnviados = (correosEnviadosData ?? []) as unknown as CorreoEnviado[];
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
  // assign_lead solo acepta ejecutivos activos del equipo del registro; la RLS
  // ya limita al supervisor a los de sus equipos.
  const reassignAgents: { id: string; full_name: string }[] = [];
  if (canReassign) {
    const agentsQuery = supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "agente")
      .eq("active", true)
      .order("full_name");
    if (lead.team_id) agentsQuery.eq("team_id", lead.team_id);
    const { data: agentRows } = await agentsQuery;
    for (const row of agentRows ?? []) reassignAgents.push({ id: row.id, full_name: row.full_name ?? "Sin nombre" });
  }
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
  // Con otra gestión abierta, la base rechaza llamar, registrar una gestión
  // sin llamada y corregir: esos botones sólo llevaban a un loop de errores.
  const otherOpenManagement =
    canManageCall && !call && profile.role === "agente" ? await getMyOpenManagement() : null;
  const revisableCall =
    canManageCall && !call && !otherOpenManagement && lead.managed_by === profile.id
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
    ...correosRecibidos.map((correo): TimelineEntry => ({
      key: `correo-recibido-${correo.id}`,
      source: "email",
      date: correo.received_at,
      title: "El cliente respondió por correo",
      notes: correo.subject,
      agenda: null,
      agent: correo.from_name || correo.from_address,
    })),
    ...correosEnviados.map((correo): TimelineEntry => ({
      key: `correo-enviado-${correo.id}`,
      source: "email",
      date: correo.created_at,
      title: correo.estado === "fallido" ? "Respuesta por correo: no salió" : "Respuesta enviada por correo",
      notes: `Para ${correo.destinatario}`,
      agenda: null,
      agent: relationOne(correo.profiles)?.full_name ?? "Ejecutivo",
    })),
    ...((quotesData ?? []) as EquifaxQuoteRow[]).map((quote): TimelineEntry => {
      const amounts = [
        Number(quote.uf_mensual) > 0 ? `${formatUfAmount(Number(quote.uf_mensual))} UF/mes` : null,
        Number(quote.uf_unico) > 0 ? `${formatUfAmount(Number(quote.uf_unico))} UF pago único` : null,
        Number(quote.uf_anual) > 0 ? `${formatUfAmount(Number(quote.uf_anual))} UF/año` : null,
        Number(quote.clp_total) > 0 ? formatClp(Number(quote.clp_total)) : null,
      ].filter(Boolean).join(" · ");
      const failed = quote.estado === "fallida";
      return {
        key: `cotizacion-${quote.id}`,
        source: quote.canal === "correo" ? "email" : "whatsapp",
        date: quote.created_at,
        title: failed
          ? "Propuesta Equifax: el correo no salió"
          : quote.canal === "correo" ? "Propuesta Equifax enviada por correo" : "Propuesta Equifax por WhatsApp",
        notes: [
          `${(quote.productos ?? []).join(", ")}${amounts ? ` · ${amounts}` : ""}`,
          `Para ${quote.destinatario}`,
          failed && quote.error ? quote.error : null,
        ].filter(Boolean).join(" · "),
        agenda: null,
        agent: relationOne(quote.profiles)?.full_name ?? "Ejecutivo",
      };
    }),
  ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

  // Mismo criterio que registrar_cotizacion_equifax: el ejecutivo cotiza lo
  // que está a su nombre; supervisión y administración, cualquier registro.
  const canQuoteWithoutManagement = equifaxCommercialFieldsEnabled
    && profile.active
    && (profile.role !== "agente" || lead.assigned_to === profile.id || lead.managed_by === profile.id);

  const statusLabel = LEAD_STATUSES.find((status) => status.value === lead.status)?.label ?? lead.status;
  const overdue = lead.next_action_at ? new Date(lead.next_action_at).getTime() <= new Date().getTime() : false;
  // Mismo dueño que usan el discador y begin_agent_agenda_callback. Las 447
  // agendas migradas de Equifax tienen managed_by pero assigned_to vacío, así
  // que exigir la asignación dejaba al ejecutivo sin botón en su propia ficha.
  const ownsAgenda = Boolean(lead.next_action_at)
    && profile.role === "agente"
    && (lead.managed_by ?? lead.assigned_to) === profile.id;

  // Estado operativo con el mismo criterio que la cola de Registros: lo que el
  // ejecutivo tiene que hacer con este cliente ahora, no el valor crudo.
  const now = new Date();
  const nextActionDate = lead.next_action_at ? new Date(lead.next_action_at) : null;
  const managed = Boolean(lead.managed_at) || lead.assignment_status === "managed" || lead.workflow_status === "managed";
  const operationalState: OperationalState = call
    ? { label: call.management_channel ? "Gestión sin llamada" : "En gestión", icon: PhoneCall, tone: "primary" }
    : !lead.phone?.trim()
      ? { label: "Sin teléfono", icon: AlertTriangle, tone: "rose", danger: true }
      : overdue
        ? { label: "Agenda vencida", icon: AlertTriangle, tone: "rose", danger: true }
        : nextActionDate && sameChileDay(nextActionDate, now)
          ? { label: "Agenda hoy", icon: CalendarClock, tone: "amber" }
          : !managed
            ? { label: "Disponible", icon: PhoneCall, tone: "primary" }
            : nextActionDate
              ? { label: "Agenda futura", icon: CalendarClock, tone: "slate" }
              : { label: "Gestionado", icon: CheckCircle2, tone: "green" };
  const timelineCount = record.summary?.timeline_count ?? entries.length;
  const otherContacts = contacts.filter((contact) => contact.contact_type !== "phone");
  const stageLabel = WORKFLOW_STAGE_LABEL[lead.workflow_status ?? ""] ?? lead.workflow_status ?? "Sin iniciar";
  // Durante la gestión el formulario manda: la columna se ensancha en pantallas
  // grandes y las dos franjas (gestión y resto de la ficha) comparten columnas.
  const columns = call
    ? "xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]"
    : "lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]";

  // Contacto y teléfonos: el primer grupo de la columna del cliente.
  const contactCard = (
    <>
      <PropertyGroup icon={Contact} title="Contacto">
        <PropertyList>
          {contactPerson && <Property label="Persona">{contactPerson}</Property>}
          <Property label="RUT" empty={!lead.rut}>
            <span className="tabular-nums">{lead.rut ?? "Sin RUT"}</span>
          </Property>
          <Property label="Teléfono" empty={!lead.phone}>
            <span className="tabular-nums">{lead.phone ?? "Sin teléfono"}</span>
          </Property>
          <Property label="Correo" empty={!lead.email}>
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="break-all text-foreground hover:text-primary hover:underline">
                {lead.email}
              </a>
            ) : (
              "Sin correo"
            )}
          </Property>
        </PropertyList>

        {otherContacts.length > 0 && (
          <ul className="mt-4 space-y-2.5 border-t border-border pt-3 text-[13px]">
            {otherContacts.map((contact) => (
              <li key={contact.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-foreground">{contact.value}</p>
                  <p className="text-xs text-muted-foreground">
                    {contact.contact_type === "phone" ? "Teléfono" : "Correo"}
                    {contact.label ? ` · ${contact.label}` : ""}
                    {contact.is_primary ? " · Principal" : ""}
                  </p>
                </div>
                {contact.is_valid === false && <Badge tone="danger">Inválido</Badge>}
              </li>
            ))}
          </ul>
        )}
      </PropertyGroup>

      {/* Teléfonos en el orden en que se llaman; supervisión agrega los
          que están fuera de base y elige el principal. */}
      <PropertyGroup icon={Phone} title="Teléfonos para llamar">
        <LeadPhonesPanel
          leadId={lead.id}
          canManage={profile.role === "admin" || profile.role === "supervisor"}
        />
      </PropertyGroup>
    </>
  );

  function renderDebt() {
    if (!debt) return null;
    const ageTone = debtAgeTone(debt.diasMora);
    return (
      <PropertyGroup icon={Wallet} title="Estado de la deuda" meta={debt.estado ? <Badge tone="neutral">{debt.estado}</Badge> : null}>
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">Saldo pendiente</p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums text-foreground">{formatClp(debt.monto)}</p>
          {debt.montoUf !== null && <p className="text-xs tabular-nums text-muted-foreground">{debt.montoUf} UF</p>}
        </div>
        <PropertyList>
          <Property label="Mora" empty={debt.diasMora === null}>
            <span className={ageTone === "danger" ? "font-medium text-danger" : ageTone === "warning" ? "font-medium text-warning" : undefined}>
              {debt.diasMora !== null ? `${debt.diasMora} días` : "Sin informar"}
            </span>
            {debt.tramo && <span className="block text-xs text-muted-foreground">{debt.tramo}</span>}
          </Property>
          <Property label="Cuotas impagas" empty={!debt.cuotas}>
            {debt.cuotas ?? "—"}
            {debt.tipo && <span className="block text-xs text-muted-foreground">{debt.tipo}</span>}
          </Property>
          <Property label="Vencimiento más antiguo" empty={!debt.vencimiento}>{debt.vencimiento ?? "—"}</Property>
          {debt.alumno && (
            <Property label="Alumno">
              {debt.alumno}
              {debt.curso && <span className="block text-xs text-muted-foreground">{debt.curso}</span>}
            </Property>
          )}
          {debt.sede && <Property label="Sede">{debt.sede}</Property>}
        </PropertyList>
      </PropertyGroup>
    );
  }

  function renderCampaignData() {
    return (
      <PropertyGroup icon={Database} title="Datos cargados de la base" meta={<CountBox>{campaignData.length}</CountBox>}>
        {/* Etiqueta arriba y valor abajo: las claves de la carga son largas y
            en dos columnas se cortaban. */}
        <dl className="space-y-2.5 text-[13px]">
          {campaignData.map(([key, value], index) => (
            <div key={`${key}-${index}`} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{key}</dt>
              <dd className="mt-0.5 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </PropertyGroup>
    );
  }

  const operationGroup = (
    <PropertyGroup
      icon={Briefcase}
      title="Gestión"
      meta={
        campaign?.id && profile.role === "admin" ? (
          <Link
            href={`/dashboard/admin/campanas/${campaign.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            Abrir campaña
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        ) : null
      }
    >
      <PropertyList>
        <Property label="Campaña" empty={!campaign?.name}>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {campaign?.name && <Avatar name={campaign.name} size="xs" shape="square" />}
            <span className="min-w-0 break-words">{campaign?.name ?? "Sin campaña"}</span>
          </span>
        </Property>
        <Property label="Flujo" empty={!workflow?.name}>{workflow?.name ?? "Sin flujo asignado"}</Property>
        <Property
          label={
            <span className="inline-flex items-center gap-1">
              {metricDefinition("etapa_flujo").label}
              <InfoTooltip text={metricDefinition("etapa_flujo").definition} />
            </span>
          }
        >
          {stageLabel}
        </Property>
        <Property label="Estado del registro">{statusLabel}</Property>
        {profile.role !== "agente" && (
          <>
            <Property label="Ejecutivo" empty={!assignedProfile}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {assignedProfile && <Avatar name={assignedProfile.full_name} size="xs" />}
                <span className="min-w-0 break-words">{assignedProfile?.full_name ?? "Sin asignar"}</span>
              </span>
            </Property>
            <Property label="Equipo" empty={!team}>{team?.name ?? "Sin equipo"}</Property>
          </>
        )}
        <Property label="Última gestión" empty={!lead.managed_at}>
          {lead.managed_at ? dateTimeLabel(lead.managed_at) : "Sin gestión"}
        </Property>
        <Property label="Actualizado">
          <span title={dateTimeLabel(lead.updated_at)}>{relativeLabel(lead.updated_at)}</span>
        </Property>
      </PropertyList>
    </PropertyGroup>
  );

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/leads"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        {profile.role === "agente" ? "Mis registros" : "Registros"}
      </Link>

      <RecordHeader
        name={lead.full_name}
        seed={lead.rut ?? lead.full_name}
        identifiers={[
          lead.rut ? <span className="tabular-nums">{lead.rut}</span> : null,
          lead.phone ? <span className="tabular-nums">{lead.phone}</span> : <span className="text-danger">Sin teléfono</span>,
          contactPerson ? <span>Contacto: <span className="font-medium text-foreground">{contactPerson}</span></span> : null,
        ]}
        tags={isOutsideBaseLead(lead.extra) ? <Badge tone="info">Fuera de base</Badge> : null}
        actions={
          <>
            {/* Con la llamada al aire el cronómetro está en la barra del teléfono. */}
            {call && (
              <span className="cti-hide-in-call">
                <CallTimer startedAt={call.started_at} endedAt={call.ended_at} />
              </span>
            )}
            {/* Contacto por otro canal (WhatsApp propio, correo, presencial):
                se tipifica sin volver a llamar. */}
            {profile.role === "agente" && canManageCall && !call && !otherOpenManagement &&
              (lead.managed_by === profile.id || lead.assigned_to === profile.id) && (
              <OfflineManagementButton leadId={lead.id} />
            )}
            {revisableCall && !correctionRequested && (
              <Link
                href={`/dashboard/leads/${lead.id}?corregir=1`}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                <PencilLine size={14} aria-hidden="true" />
                Corregir tipificación
              </Link>
            )}
            {canReassign && (
              <LeadReassignPanel
                leadId={lead.id}
                leadName={lead.full_name}
                currentAgentId={lead.assigned_to}
                currentAgentName={assignedProfile?.full_name ?? null}
                teamName={team?.name ?? null}
                hasPendingAgenda={Boolean(lead.next_action_at)}
                agents={reassignAgents}
              />
            )}
            {/* Sin gestión abierta, un compromiso propio se puede marcar desde
                aquí aunque la campaña sea automática: el discador solo entrega
                el callback dentro de su ventana y después queda incallable.
                Llamar es la acción principal de la ficha: va al final y en primario. */}
            {canManageCall && !call && !otherOpenManagement && (canOperateAssigned || ownsManagedRecord || ownsAgenda) && lead.phone && (
              <AgendaCallButton
                leadId={lead.id}
                fullName={lead.full_name}
                variant="primary"
                label={lead.next_action_at && overdue ? "Llamar compromiso vencido" : "Llamar ahora"}
                // Con agenda propia se abre como agenda: queda tomada y el
                // discador ya no la marca en paralelo ni después.
                source={ownsAgenda ? "agenda" : "assigned_lead"}
              />
            )}
          </>
        }
        facts={
          <RecordFacts>
            <RecordFact label="Estado operativo" detail={statusLabel}>
              <StateChip
                icon={operationalState.icon}
                tone={operationalState.tone}
                label={operationalState.label}
                danger={operationalState.danger}
              />
            </RecordFact>
            <RecordFact
              label={debt ? "Próximo compromiso" : "Próxima acción"}
              detail={lead.next_action_at ? dateTimeLabel(lead.next_action_at) : "Nada agendado"}
            >
              {lead.next_action_at ? (
                <span className={overdue ? "text-danger" : undefined}>
                  {overdue ? "Vencida · " : ""}
                  {relativeLabel(lead.next_action_at)}
                </span>
              ) : (
                <span className="text-muted-foreground">Sin agenda</span>
              )}
            </RecordFact>
            <RecordFact
              label="Última gestión"
              detail={lead.tipificacion_actual ? sentenceCase(lead.tipificacion_actual) : "Todavía sin tipificar"}
            >
              {lead.managed_at ? (
                <span title={dateTimeLabel(lead.managed_at)}>{relativeLabel(lead.managed_at)}</span>
              ) : (
                <span className="text-muted-foreground">Sin gestión</span>
              )}
            </RecordFact>
            {debt ? (
              <RecordFact
                label="Saldo pendiente"
                detail={debt.diasMora !== null ? `${debt.diasMora} días de mora` : "Mora sin informar"}
              >
                <span className="tabular-nums">{formatClp(debt.monto)}</span>
              </RecordFact>
            ) : (
              <RecordFact label="Campaña" detail={workflow?.name ?? "Sin flujo asignado"}>
                <span className="flex min-w-0 items-center gap-2">
                  {campaign?.name && <Avatar name={campaign.name} size="xs" shape="square" />}
                  <span className={campaign?.name ? "truncate" : "truncate text-muted-foreground"}>
                    {campaign?.name ?? "Sin campaña"}
                  </span>
                </span>
              </RecordFact>
            )}
            {profile.role !== "agente" ? (
              <RecordFact label="Responsable" detail={team?.name ?? "Sin equipo"}>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={assignedProfile?.full_name} size="xs" />
                  <span className={assignedProfile ? "truncate" : "truncate text-muted-foreground"}>
                    {assignedProfile?.full_name ?? "Sin asignar"}
                  </span>
                </span>
              </RecordFact>
            ) : (
              <RecordFact label="Actividad" detail={`Actualizado ${relativeLabel(lead.updated_at).toLocaleLowerCase("es-CL")}`}>
                <span className="tabular-nums">
                  {timelineCount.toLocaleString("es-CL")} {timelineCount === 1 ? "gestión" : "gestiones"}
                </span>
              </RecordFact>
            )}
          </RecordFacts>
        }
      />

      {!permissions.canAttendCustomers && (
        <Callout tone="info">
          Vista de consulta y control. La atención y la tipificación pertenecen al ejecutivo responsable.
          {!leeConversaciones && " El contenido de las conversaciones WhatsApp no se consulta desde Administración."}
        </Callout>
      )}

      {otherOpenManagement && (
        <Callout tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Tienes una gestión pendiente con {otherOpenManagement.leadName ?? "otro registro"}. Tipifícala antes de
              llamar o registrar otra gestión.
            </span>
            <Link
              href={`/dashboard/leads/${otherOpenManagement.leadId}?tipificar=1`}
              className={buttonClasses({ size: "sm" })}
            >
              Ir a tipificarla
            </Link>
          </div>
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
        <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="icon-chip mt-0.5 size-8 rounded-lg" data-tone="violet" aria-hidden="true">
                <ShieldCheck size={16} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Supervisión de la gestión</h2>
                <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
                  Corrige una tipificación o agrega la última. Una venta que no se marcó como tal entra a la validación de
                  ventas al dejarla como VENTA EN VALIDACION.
                </p>
              </div>
            </div>
            <Link
              href={`/dashboard/leads/${lead.id}?supervisar=nueva#supervision-form`}
              aria-current={supervisionTarget === "nueva" ? "true" : undefined}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Agregar tipificación
            </Link>
          </div>
          {supervisionContext.managements.length === 0 ? (
            <p className="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">
              Este registro no tiene gestiones tipificadas.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {supervisionContext.managements.map((management) => {
                const selected = supervisionTarget === management.id;
                const body = (
                  <>
                    <Avatar name={management.agentName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {management.reason ? sentenceCase(management.reason) : "Sin tipificación"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          dateTimeLabel(management.endedAt),
                          management.agentName,
                          management.channel === "supervision" ? "Registrada por supervisión" : null,
                          management.fromAtlas1 ? "Atlas 1" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={management.id}>
                    {management.fromAtlas1 ? (
                      <div
                        className="flex items-center gap-3 px-5 py-3 text-sm"
                        title="El historial de Atlas 1 no se reescribe: agrega una tipificación nueva."
                      >
                        {body}
                        <span className="shrink-0 text-xs text-muted-foreground">No se corrige</span>
                      </div>
                    ) : (
                      // La fila entera abre la corrección; la flecha dice que navega.
                      <Link
                        href={`/dashboard/leads/${lead.id}?supervisar=${management.id}#supervision-form`}
                        aria-current={selected ? "true" : undefined}
                        className={`group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-muted/60 ${selected ? "bg-surface-muted" : ""}`}
                      >
                        {body}
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-primary">
                          <PencilLine size={13} aria-hidden="true" />
                          {selected ? "Corrigiendo" : "Corregir"}
                          <ChevronRight size={14} aria-hidden="true" />
                        </span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {supervisionContext && supervisionTarget && !supervisedCall && (
        <Callout tone="warning">No se encontró esa gestión, o fue descartada.</Callout>
      )}

      {supervisionContext && supervisedCall && (
        <section id="supervision-form" className="scroll-mt-4">
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
        <div className={`grid items-start gap-5 ${columns}`}>
          <section
            id="gestion-en-curso"
            {...{ [OPEN_CALL_FORM_ATTRIBUTE]: call.id }}
            className="min-w-0 scroll-mt-4 space-y-3"
          >
            {/* Cierra la medición de cuánto tardó la ficha en aparecer. */}
            {profile.role === "agente" && <ScreenPopTiming leadId={lead.id} />}
            {call.management_channel && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="icon-chip size-6 rounded-md" data-tone="blue" aria-hidden="true">
                  <PhoneCall size={12} />
                </span>
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
              quoteClient={{
                empresa: lead.full_name,
                rut: lead.rut,
                contacto: contactPerson,
                correo: lead.email,
                telefono: lead.phone,
              }}
            />
          </section>
          {/* Fija junto al formulario; si es más alta que la pantalla, se
              desplaza sola en vez de cortarse. */}
          <aside
            className={`${SIDE_PANEL} xl:sticky xl:top-0 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto`}
            aria-label="Datos del cliente"
          >
            {contactCard}
            {debt && renderDebt()}
            {campaignData.length > 0 && renderCampaignData()}
          </aside>
        </div>
      )}

      {!call && revisableCall && correctionRequested && (
        <section className="scroll-mt-4">
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

      <div className={`grid items-start gap-5 ${columns}`}>
        {/* La acción de ahora y el hilo completo */}
        <div className="min-w-0 space-y-5">
          {/* Sin gestión abierta también se cotiza: la propuesta queda en el
              registro. Durante la gestión va dentro de la tipificación. */}
          {!call && canQuoteWithoutManagement && (
            <CotizadorEquifax
              leadId={lead.id}
              callId={null}
              cliente={{
                empresa: lead.full_name,
                rut: lead.rut,
                contacto: contactPerson,
                correo: lead.email,
                telefono: lead.phone,
              }}
            />
          )}

          <CorreoRegistroPanel
            leadId={lead.id}
            recibidos={correosRecibidos}
            enviados={correosEnviados}
            // Si la RLS le mostró el correo, es suyo o del registro que lleva.
            puedeResponder={profile.active}
          />

          <MailThreadPanel
            leadId={lead.id}
            messages={mailMessages}
            commands={mailReplyCommands}
            canReply={canOperateAssigned}
          />

          <LeadTimeline entries={entries} />
        </div>

        {/* Propiedades del registro, agrupadas. Durante la gestión el contacto,
            la deuda y la base ya están junto al formulario. */}
        {/* En el teléfono va primero: el contacto antes que el historial. */}
        <aside className={`${SIDE_PANEL} ${call ? "" : "max-lg:order-first"}`} aria-label="Propiedades del registro">
          {!call && contactCard}
          {operationGroup}
          {!call && debt && renderDebt()}
          {!call && campaignData.length > 0 && renderCampaignData()}

          {/* Dato de integración: al ejecutivo no le cambia nada de la gestión. */}
          {profile.role !== "agente" && (
            <PropertyGroup icon={RefreshCw} title="Sincronización 360" meta={externalRefs.length ? <CountBox>{externalRefs.length}</CountBox> : null}>
              {externalRefs.length ? (
                <ul className="space-y-3 text-[13px]">
                  {externalRefs.map((reference) => {
                    const source = relationOne(reference.integration_sources);
                    const sourceName = source?.name ?? source?.code ?? "Externo";
                    return (
                      <li key={reference.id} className="flex min-w-0 items-start gap-2.5">
                        <Avatar name={sourceName} size="sm" shape="square" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 font-medium text-foreground">
                            <StatusDot tone="success" />
                            <span className="truncate">{sourceName}</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={reference.external_key}>
                            {reference.external_key}
                          </p>
                          <p className="text-xs text-muted-foreground" title={dateTimeLabel(reference.last_seen_at)}>
                            Última señal {relativeLabel(reference.last_seen_at).toLocaleLowerCase("es-CL")}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">Sin referencias externas para este registro.</p>
              )}
            </PropertyGroup>
          )}
        </aside>
      </div>
    </div>
  );
}
