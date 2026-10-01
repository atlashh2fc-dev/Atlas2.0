import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Database,
  Eye,
  History,
  Inbox,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Phone,
  UserRound,
  XCircle,
} from "lucide-react";

import {
  assignWhatsAppConversation,
  closeWhatsAppConversation,
  markWhatsAppConversationRead,
  setWhatsAppConversationStatus,
  takeOverWhatsAppConversation,
} from "@/app/actions/whatsapp";
import { LogoDeIntegracion } from "@/components/logo-integracion";
import { WhatsAppAutoRefresh } from "@/components/whatsapp-auto-refresh";
import { WhatsAppComposer } from "@/components/whatsapp-composer";
import { WhatsAppMessageMedia } from "@/components/whatsapp-message-media";
import { CierreAtencionCampos } from "./cierre-atencion-campos";
import {
  ActionForm,
  ActionSubmit,
  Avatar,
  Badge,
  Callout,
  EmptyState,
  SegmentTabs,
  Select,
  buttonClasses,
  type SegmentTab,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { puedeLeerConversaciones } from "@/lib/modules.server";
import { attentionChannelHref } from "@/lib/campaign-channels";
import { canalDeMensajeria, NOMBRE_DEL_CANAL } from "@/lib/mensajeria-social";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { LEAD_STATUSES } from "@/lib/types";

const LEAD_STATUS_LABEL = new Map<string, string>(LEAD_STATUSES.map((item) => [item.value, item.label]));

type Relation<T> = T | T[] | null;
type ConversationStatus = "open" | "pending" | "closed";
type CampaignSummary = { id: string; name: string };
type ClosureReason = {
  id: string;
  label: string;
  requires_note: boolean;
  is_automatic: boolean;
};
type AiConfig = { enabled: boolean; model: string };
type HandoffEvent = {
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type LeadSummary = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  rut: string | null;
  status: string;
  tipificacion_actual: string | null;
  next_action_at: string | null;
  workflow_status: string | null;
  managed_at: string | null;
  extra: Record<string, unknown> | null;
};

type LeadTimelineItem = {
  source: "call" | "interaction";
  id: string;
  occurred_at: string | null;
  title: string | null;
  notes: string | null;
  agent_name: string;
};

type Lead360Context = {
  lead: LeadSummary;
  summary: { timeline_count: number; last_activity_at: string | null };
  timeline: LeadTimelineItem[];
};

type Conversation = {
  id: string;
  campaign_id: string;
  queue_id: string | null;
  lead_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  canal: string | null;
  assigned_to: string | null;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string;
  referral: Record<string, unknown>;
  ai_state: "auto" | "paused" | "handoff";
  ai_last_error: string | null;
  close_reason_id: string | null;
  close_note: string | null;
  closed_at: string | null;
  whatsapp_closure_reasons: Relation<{ label: string }>;
  campaigns: Relation<CampaignSummary>;
  contact_center_queues: Relation<{ id: string; name: string }>;
  leads: Relation<LeadSummary>;
  profiles: Relation<{ id: string; full_name: string }>;
  whatsapp_channels: Relation<{
    status: string;
    business_name: string | null;
    display_phone_number: string | null;
    cuenta: string | null;
  }>;
};

/** Sin nombre ni teléfono (Instagram y Messenger), se dice de qué red escribió. */
function nombreDelContacto(conversation: Pick<Conversation, "contact_name" | "contact_phone" | "canal">) {
  return conversation.contact_name || conversation.contact_phone || `Contacto de ${NOMBRE_DEL_CANAL[canalDeMensajeria(conversation.canal)]}`;
}

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text_body: string | null;
  status: string;
  provider_timestamp: string | null;
  created_at: string;
  error_message: string | null;
  provider_payload: Record<string, unknown> | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  media_status: "pending" | "ready" | "failed" | null;
  profiles: Relation<{ full_name: string }>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const ZONA_CHILE = "America/Santiago";
/** YYYY-MM-DD en hora Chile: sirve para comparar días sin pelear con UTC. */
const diaChile = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_CHILE });
const horaChile = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CHILE, hour: "2-digit", minute: "2-digit" });
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CHILE, day: "numeric", month: "short" });
const diaLargo = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CHILE, weekday: "long", day: "numeric", month: "long" });

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", {
    timeZone: ZONA_CHILE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Hora de la lista de hilos, como en Front o Intercom: "Ahora", "12 min",
 * "09:27" si fue hoy, "Ayer" y después la fecha corta.
 */
function horaRelativa(value: string, ahora: Date) {
  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return "—";
  const minutos = Math.floor((ahora.getTime() - fecha.getTime()) / 60_000);
  if (minutos < 1) return "Ahora";
  if (minutos < 60) return `${minutos} min`;
  const dia = diaChile.format(fecha);
  if (dia === diaChile.format(ahora)) return horaChile.format(fecha);
  if (dia === diaChile.format(new Date(ahora.getTime() - 86_400_000))) return "Ayer";
  return diaCorto.format(fecha);
}

/** Separador de día del hilo: "Hoy", "Ayer" o "Lunes 24 de mayo". */
function etiquetaDelDia(value: string, ahora: Date) {
  const fecha = new Date(value);
  const dia = diaChile.format(fecha);
  if (dia === diaChile.format(ahora)) return "Hoy";
  if (dia === diaChile.format(new Date(ahora.getTime() - 86_400_000))) return "Ayer";
  const texto = diaLargo.format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function messageStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Enviando",
    accepted: "Aceptado",
    sent: "Enviado",
    delivered: "Entregado",
    read: "Leído",
    failed: "Falló",
    deleted: "Eliminado",
    received: "Recibido",
  };
  return labels[status] ?? status;
}

function conversationLabel(status: ConversationStatus) {
  return status === "open"
    ? "Abierta"
    : status === "pending"
      ? "Pendiente"
      : "Cerrada";
}

/** "VOLVER A LLAMAR" → "Volver a llamar": lo que llega en mayúsculas desde la base. */
function enOracion(texto: string) {
  if (texto !== texto.toUpperCase()) return texto;
  const minusculas = texto.toLocaleLowerCase("es-CL");
  return minusculas.charAt(0).toLocaleUpperCase("es-CL") + minusculas.slice(1);
}

function sourceLabel(source: LeadTimelineItem["source"]) {
  return source === "call" ? "Llamada" : "Gestión";
}

function fieldLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function handoffKindLabel(value: unknown) {
  const labels: Record<string, string> = {
    human_requested: "Solicitó atención humana",
    agent_takeover: "Atención tomada por el ejecutivo",
    appointment: "Solicitó agendamiento",
    quote: "Solicitó cotización formal",
    unknown: "Requiere confirmación especializada",
    complaint: "Molestia o reclamo",
  };
  return typeof value === "string"
    ? (labels[value] ?? "Derivación a especialista")
    : "Derivación a especialista";
}

function isMercuryMessage(payload: Record<string, unknown> | null) {
  const ai =
    payload && typeof payload.ai === "object" && payload.ai !== null
      ? (payload.ai as Record<string, unknown>)
      : null;
  return ai?.provider === "mercury";
}

function conversationsHref({
  status,
  campaign,
  queue,
  conversation,
}: {
  status: ConversationStatus | "all";
  campaign?: string | null;
  queue?: string | null;
  conversation?: string | null;
}) {
  return attentionChannelHref("whatsapp", {
    status,
    campaign,
    queue,
    conversation,
  });
}

function ContextSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: ComponentType<{ size?: number }>;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border/70 px-4 py-4 last:border-b-0">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground">
        {Icon && (
          <span className="inline-flex text-muted-foreground" aria-hidden="true">
            <Icon size={14} />
          </span>
        )}
        {title}
      </h3>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

function ContextRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium text-foreground">
        {children || "—"}
      </span>
    </div>
  );
}

export default async function WhatsAppInboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    conversation?: string;
    status?: string;
    campaign?: string;
    queue?: string;
  }>;
}) {
  const profile = await requireProfile();
  const permissions = getWorkspacePermissions(profile.role);
  // Administration monitors metadata; it never opens a customer transcript,
  // except the platform owner, who reads without being able to reply.
  if (!(await puedeLeerConversaciones(profile.role))) redirect("/dashboard/operacion");
  const params = await searchParams;
  const status = (["open", "pending", "closed", "all"] as const).includes(
    params.status as ConversationStatus | "all",
  )
    ? (params.status as ConversationStatus | "all")
    : "open";
  const campaignFilter =
    params.campaign && UUID.test(params.campaign) ? params.campaign : null;
  const queueFilter =
    params.queue && UUID.test(params.queue) ? params.queue : null;
  const supabase = await createClient();

  let conversationQuery = supabase
    .from("whatsapp_conversations")
    .select(
      "id, campaign_id, queue_id, lead_id, contact_name, contact_phone, canal, assigned_to, status, unread_count, last_message_at, referral, ai_state, ai_last_error, close_reason_id, close_note, closed_at, whatsapp_closure_reasons(label), campaigns(id, name), contact_center_queues(id, name), leads(id, full_name, phone, email, rut, status, tipificacion_actual, next_action_at, workflow_status, managed_at, extra), profiles:profiles!whatsapp_conversations_assigned_to_fkey(id, full_name), whatsapp_channels(status, business_name, display_phone_number, cuenta)",
    )
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (status !== "all")
    conversationQuery = conversationQuery.eq("status", status);
  if (campaignFilter)
    conversationQuery = conversationQuery.eq("campaign_id", campaignFilter);
  if (queueFilter)
    conversationQuery = conversationQuery.eq("queue_id", queueFilter);
  if (permissions.canAttendCustomers)
    conversationQuery = conversationQuery.eq("assigned_to", profile.id);

  const [
    { data: conversationData, error: conversationError },
    { data: campaignData },
  ] = await Promise.all([
    conversationQuery,
    supabase.from("campaigns").select("id, name").order("name"),
  ]);
  const conversations = (conversationData ?? []) as Conversation[];
  const campaigns = (campaignData ?? []) as CampaignSummary[];
  const selectedId = conversations.some(
    (item) => item.id === params.conversation,
  )
    ? params.conversation!
    : null;
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  let messages: Message[] = [];
  let memberships: Array<{
    profiles: Relation<{ id: string; full_name: string }>;
  }> = [];
  let lead360: Lead360Context | null = null;
  let closureReasons: ClosureReason[] = [];
  let aiConfig: AiConfig | null = null;
  let handoffEvent: HandoffEvent | null = null;
  let messageError: string | null = null;
  let automationError = false;
  if (selected) {
    const [
      messageResult,
      membershipResult,
      lead360Result,
      closureReasonResult,
      aiConfigResult,
      handoffEventResult,
    ] = await Promise.all([
      supabase
        .from("whatsapp_messages")
        .select(
          "id, direction, message_type, text_body, status, provider_timestamp, created_at, error_message, provider_payload, media_mime_type, media_file_name, media_status, profiles(full_name)",
        )
        .eq("conversation_id", selected.id)
        .order("provider_timestamp", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(500),
      profile.role === "agente"
        ? Promise.resolve({ data: [] })
        : selected.queue_id
          ? supabase
              .from("contact_center_queue_members")
              .select("profile_id, profiles!inner(id, full_name, active, role)")
              .eq("queue_id", selected.queue_id)
              .eq("is_active", true)
              .eq("profiles.active", true)
              .eq("profiles.role", "agente")
          : supabase
              .from("campaign_agents")
              .select("profile_id, profiles!inner(id, full_name, active, role)")
              .eq("campaign_id", selected.campaign_id)
              .eq("profiles.active", true)
              .eq("profiles.role", "agente"),
      supabase.rpc("get_lead_360", { p_lead_id: selected.lead_id }),
      supabase
        .from("whatsapp_closure_reasons")
        .select("id, label, requires_note, is_automatic")
        .eq("campaign_id", selected.campaign_id)
        .eq("is_active", true)
        .eq("is_automatic", false)
        .order("sort_order"),
      supabase
        .from("whatsapp_ai_configs")
        .select("enabled, model")
        .eq("campaign_id", selected.campaign_id)
        .maybeSingle(),
      supabase
        .from("whatsapp_conversation_events")
        .select("note, metadata, created_at")
        .eq("conversation_id", selected.id)
        .eq("event_type", "ai_handoff")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    messages = (messageResult.data ?? []) as Message[];
    messageError = messageResult.error?.message ?? null;
    memberships = (membershipResult.data ?? []) as typeof memberships;
    lead360 = lead360Result.data as Lead360Context | null;
    closureReasons = (closureReasonResult.data ?? []) as ClosureReason[];
    aiConfig = aiConfigResult.data as AiConfig | null;
    automationError = Boolean(aiConfigResult.error);
    handoffEvent = handoffEventResult.data as HandoffEvent | null;
  }

  const agentOptions = memberships.flatMap((membership) => {
    const agent = one(membership.profiles);
    return agent ? [agent] : [];
  });
  const canManage = permissions.canManageAssignments;
  const campaign = selected ? one(selected.campaigns) : null;
  const queue = selected ? one(selected.contact_center_queues) : null;
  const assigned = selected ? one(selected.profiles) : null;
  const channel = selected ? one(selected.whatsapp_channels) : null;
  const lead = lead360?.lead ?? (selected ? one(selected.leads) : null);
  const humanAttentionReady =
    !automationError &&
    (aiConfig?.enabled === false ||
      selected?.ai_state === "handoff" ||
      selected?.ai_state === "paused");
  const sendReady = channel?.status === "active" && humanAttentionReady;
  const referral = selected?.referral ?? {};
  const closureReason = selected
    ? one(selected.whatsapp_closure_reasons)
    : null;
  const referralHeadline =
    typeof referral.headline === "string" ? referral.headline : null;
  const referralBody = typeof referral.body === "string" ? referral.body : null;
  const dynamicData = Object.entries(lead?.extra ?? {})
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    )
    .slice(0, 10);

  // El corte de "hoy" y "ayer" es el instante de la petición, en hora Chile.
  const ahora = new Date();
  const estados: SegmentTab[] = (["open", "pending", "closed", "all"] as const).map((value) => ({
    id: value,
    label:
      value === "open"
        ? "Abiertas"
        : value === "pending"
          ? "Pendientes"
          : value === "closed"
            ? "Cerradas"
            : "Todas",
    href: conversationsHref({ status: value, campaign: campaignFilter, queue: queueFilter }),
  }));
  // Separadores de día en el hilo: la hora de cada burbuja ya no repite la fecha.
  const mensajesPorDia: { dia: string; etiqueta: string; mensajes: Message[] }[] = [];
  for (const message of messages) {
    const instante = message.provider_timestamp ?? message.created_at;
    const dia = diaChile.format(new Date(instante));
    const ultimo = mensajesPorDia[mensajesPorDia.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.mensajes.push(message);
    else mensajesPorDia.push({ dia, etiqueta: etiquetaDelDia(instante, ahora), mensajes: [message] });
  }

  return (
    <div className="space-y-4">
      {permissions.canAttendCustomers && (
        <WhatsAppAutoRefresh conversationId={selectedId} />
      )}
      <p className="text-[13px] text-muted-foreground">
        {permissions.canAttendCustomers
          ? "Atiende únicamente las conversaciones asignadas a ti. Cada gestión conserva campaña, registro e historial."
          : "Consulta autorizada por selección explícita. Supervisar no responde al cliente ni marca mensajes como leídos."}
      </p>

      {conversationError ? (
        <Callout tone="warning">
          No se pudieron consultar las conversaciones. Los datos no están
          disponibles; vuelve a intentar o revisa los permisos de tu cuenta.
        </Callout>
      ) : (
        <div className="grid min-h-[32rem] overflow-hidden rounded-xl border border-border bg-surface shadow-sm lg:h-[calc(100dvh-12rem)] lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(28rem,1fr)_19rem]">
          <aside className="border-b border-border lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
            {/* Estado como pestañas subrayadas pegadas a la lista (Front, Intercom). */}
            <div className="border-b border-border px-2">
              <SegmentTabs tabs={estados} activeId={status} label="Estado de las conversaciones" />
            </div>

            <form
              className="flex items-center gap-1.5 border-b border-border px-3 py-2.5"
              action={attentionChannelHref("whatsapp")}
            >
              <input type="hidden" name="status" value={status} />
              {queueFilter && (
                <input type="hidden" name="queue" value={queueFilter} />
              )}
              <Select
                name="campaign"
                aria-label="Campaña"
                defaultValue={campaignFilter ?? ""}
                fieldSize="sm"
                className="min-w-0 flex-1"
              >
                <option value="">Todas las campañas</option>
                {campaigns.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <button
                type="submit"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                Filtrar
              </button>
              {(campaignFilter || queueFilter) && (
                <Link
                  href={conversationsHref({ status })}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                  Limpiar
                </Link>
              )}
            </form>

            <div className="overflow-y-auto lg:min-h-0 lg:flex-1">
              {conversations.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No hay conversaciones en esta vista."
                  description={status === "open" ? "Cuando un cliente escriba, aparece acá." : "Prueba con otro estado o con todas las campañas."}
                  className="py-10"
                />
              ) : (
                <ul>
                  {conversations.map((conversation) => {
                    const itemCampaign = one(conversation.campaigns);
                    const itemAssigned = one(conversation.profiles);
                    const activa = selectedId === conversation.id;
                    const sinLeer = conversation.unread_count > 0;
                    const nombre = nombreDelContacto(conversation);
                    return (
                      <li key={conversation.id}>
                        <Link
                          href={conversationsHref({
                            status,
                            campaign: campaignFilter,
                            queue: queueFilter,
                            conversation: conversation.id,
                          })}
                          aria-current={activa ? "true" : undefined}
                          className={cn(
                            "flex gap-3 px-3.5 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            activa ? "bg-primary/[0.07]" : "hover:bg-surface-muted/60",
                          )}
                        >
                          <span className="relative shrink-0">
                            <Avatar name={nombre} seed={conversation.contact_phone ?? nombre} size="md" />
                            {/* La red por la que escribió, sobre el avatar. */}
                            <span className="absolute -bottom-1 -right-1 origin-bottom-right scale-[0.8] rounded-md ring-2 ring-surface">
                              <LogoDeIntegracion logo={canalDeMensajeria(conversation.canal)} pequeno />
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className={cn("truncate text-[13px] text-foreground", sinLeer ? "font-semibold" : "font-medium")}>
                                {nombre}
                              </span>
                              <time
                                dateTime={conversation.last_message_at}
                                title={formatDateTime(conversation.last_message_at)}
                                className={cn("shrink-0 text-[11px] tabular-nums", sinLeer ? "font-semibold text-primary" : "text-muted-foreground")}
                              >
                                {horaRelativa(conversation.last_message_at, ahora)}
                              </time>
                            </span>
                            <span className="mt-0.5 flex items-center justify-between gap-2">
                              <span className={cn("truncate text-xs", sinLeer ? "text-foreground" : "text-muted-foreground")}>
                                {itemCampaign?.name ?? "Sin campaña"}
                              </span>
                              {sinLeer && (
                                <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary">
                                  {conversation.unread_count}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                              {itemAssigned ? (
                                <>
                                  <Avatar name={itemAssigned.full_name} size="xs" />
                                  <span className="truncate">{itemAssigned.full_name}</span>
                                </>
                              ) : (
                                <span>Sin asignar</span>
                              )}
                              {conversation.status !== "open" && (
                                <span className="ml-auto shrink-0">{conversationLabel(conversation.status)}</span>
                              )}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            {!selected ? (
              <EmptyState
                icon={MessageCircle}
                title="Selecciona una conversación"
                description={
                  permissions.canAttendCustomers
                    ? "Elige una interacción asignada para iniciar tu gestión."
                    : "Elige un registro para consultar su historial. Esta vista no permite atender al cliente."
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="relative shrink-0">
                      <Avatar name={nombreDelContacto(selected)} seed={selected.contact_phone ?? nombreDelContacto(selected)} size="md" />
                      <span className="absolute -bottom-1 -right-1 origin-bottom-right scale-[0.8] rounded-md ring-2 ring-surface">
                        <LogoDeIntegracion logo={canalDeMensajeria(selected.canal)} pequeno />
                      </span>
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <h2 className="truncate text-[15px] font-semibold text-foreground">
                          {nombreDelContacto(selected)}
                        </h2>
                        <Badge
                          tone={
                            selected.status === "closed"
                              ? "neutral"
                              : selected.status === "pending"
                                ? "warning"
                                : "success"
                          }
                          dot
                        >
                          {conversationLabel(selected.status)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[
                          selected.contact_phone,
                          NOMBRE_DEL_CANAL[canalDeMensajeria(selected.canal)],
                          campaign?.name ?? "Sin campaña",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/leads/${selected.lead_id}`}
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    Ver registro 360 <ArrowUpRight size={13} />
                  </Link>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5 sm:px-6">
                  {messageError ? (
                    <Callout tone="warning">
                      No fue posible cargar el historial. No se puede confirmar
                      que no haya mensajes.
                    </Callout>
                  ) : messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Aún no hay mensajes guardados.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {mensajesPorDia.map((grupo) => (
                        <div key={grupo.dia} className="space-y-1.5">
                          <div className="flex items-center gap-3 py-1" role="separator" aria-label={grupo.etiqueta}>
                            <span className="h-px flex-1 bg-border" aria-hidden="true" />
                            <span className="text-[11px] font-medium text-muted-foreground">{grupo.etiqueta}</span>
                            <span className="h-px flex-1 bg-border" aria-hidden="true" />
                          </div>
                          {grupo.mensajes.map((message) => {
                            const sender = one(message.profiles);
                            const outbound = message.direction === "outbound";
                            const fallo = message.status === "failed";
                            return (
                              <div
                                key={message.id}
                                className={cn(
                                  "flex flex-col",
                                  outbound ? "items-end" : "items-start",
                                )}
                              >
                                {/* Burbujas limpias: la del cliente sobre superficie, la nuestra
                                    en el tono de la marca. Sin borde de color ni sombra pesada. */}
                                <div
                                  className={cn(
                                    "max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed text-foreground",
                                    outbound
                                      ? "rounded-br-md bg-primary/[0.13]"
                                      : "rounded-bl-md border border-border bg-surface shadow-sm",
                                    fallo && "ring-1 ring-danger/40",
                                  )}
                                >
                                  {(message.message_type === "image" ||
                                    message.message_type === "audio") && (
                                    <WhatsAppMessageMedia
                                      messageId={message.id}
                                      messageType={message.message_type}
                                      mimeType={message.media_mime_type}
                                      fileName={message.media_file_name}
                                    />
                                  )}
                                  {message.text_body &&
                                    message.message_type !== "audio" && (
                                      <p className="whitespace-pre-wrap break-words">
                                        {message.text_body}
                                      </p>
                                    )}
                                  {!message.text_body &&
                                    message.message_type !== "image" &&
                                    message.message_type !== "audio" && (
                                      <p className="whitespace-pre-wrap break-words italic text-muted-foreground">
                                        [{message.message_type}]
                                      </p>
                                    )}
                                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                                    {outbound &&
                                      isMercuryMessage(message.provider_payload) && (
                                        <span className="inline-flex items-center gap-1">
                                          <Bot size={11} aria-hidden="true" /> Mercury IA ·
                                        </span>
                                      )}
                                    {outbound &&
                                      !isMercuryMessage(message.provider_payload) &&
                                      sender?.full_name && (
                                        <span>{sender.full_name} ·</span>
                                      )}
                                    <time
                                      dateTime={message.provider_timestamp ?? message.created_at}
                                      title={formatDateTime(message.provider_timestamp ?? message.created_at)}
                                      className="tabular-nums"
                                    >
                                      {horaChile.format(new Date(message.provider_timestamp ?? message.created_at))}
                                    </time>
                                    {outbound && (
                                      <span className={cn("inline-flex items-center gap-0.5", fallo && "font-medium text-danger", message.status === "read" && "text-primary")}>
                                        · {message.status === "read" || message.status === "delivered" ? <CheckCheck size={12} aria-hidden="true" /> : null}
                                        {messageStatus(message.status)}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                {message.error_message && (
                                  <p className="mt-1 max-w-[78%] text-[11px] text-danger">
                                    {message.error_message}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Compositor pegado abajo: el hilo hace scroll, el editor no se mueve. */}
                {permissions.canAttendCustomers ? (
                  <div className="border-t border-border bg-surface px-4 py-3">
                    {!humanAttentionReady ? (
                      <div className="mb-3 flex flex-col gap-3 rounded-lg bg-surface-muted/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Bot size={14} className="mt-px shrink-0" aria-hidden="true" />
                          {automationError
                            ? "No fue posible verificar el modo de atención. Actualiza antes de responder."
                            : "La IA está atendiendo este hilo. Puedes tomar la atención ahora; la IA dejará de responder y se habilitará el editor."}
                        </p>
                        {!automationError && selected.ai_state === "auto" && (
                          <ActionForm
                            action={takeOverWhatsAppConversation}
                            success="Atención tomada"
                            className="shrink-0"
                          >
                            <input type="hidden" name="conversation_id" value={selected.id} />
                            <ActionSubmit pendingLabel="Tomando atención…" className="min-h-11 w-full sm:w-auto">
                              <UserRound size={15} aria-hidden="true" /> Tomar atención
                            </ActionSubmit>
                          </ActionForm>
                        )}
                      </div>
                    ) : (
                      channel?.status !== "active" && (
                        <p className="mb-2 flex items-center gap-2 text-xs text-warning">
                          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
                          El historial ya queda centralizado; falta terminar la
                          autorización del canal para responder desde Atlas.
                        </p>
                      )
                    )}
                    {humanAttentionReady && (
                      <WhatsAppComposer
                        conversationId={selected.id}
                        disabled={!sendReady}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-t border-border bg-surface-raised px-4 py-3 text-xs text-muted-foreground">
                    <Eye size={14} aria-hidden="true" />
                    Consulta de supervisión · Sin permisos de respuesta ni
                    cierre comercial.
                  </div>
                )}
              </>
            )}
          </section>

          {selected && (
            <aside className="border-t border-border bg-surface lg:col-span-2 xl:col-span-1 xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
              {/* El cierre va primero: es lo que el ejecutivo hace al terminar
                  cada atención, y antes quedaba bajo cuatro secciones. */}
              <ContextSection title="Cierre de atención" icon={CheckCheck}>
                {selected.status === "closed" ? (
                  <div className="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                    <Badge tone="success">Atención cerrada</Badge>
                    <p className="mt-1 text-xs text-foreground">
                      {closureReason?.label ?? "Tipificación registrada"}
                    </p>
                    {selected.close_note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selected.close_note}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDateTime(selected.closed_at)}
                    </p>
                  </div>
                ) : !permissions.canAttendCustomers || !humanAttentionReady ? (
                  <p className="text-xs text-muted-foreground">
                    {!humanAttentionReady
                      ? "El cierre se habilita después de la derivación a atención humana."
                      : "El cierre y la tipificación corresponden al ejecutivo responsable."}
                  </p>
                ) : closureReasons.length > 0 ? (
                  <ActionForm
                    action={closeWhatsAppConversation}
                    success="Atención cerrada y tipificada"
                    className="space-y-2"
                  >
                    <input
                      type="hidden"
                      name="conversation_id"
                      value={selected.id}
                    />
                    <CierreAtencionCampos motivos={closureReasons} />
                    <ActionSubmit
                      variant="secondary"
                      size="sm"
                      pendingLabel="Cerrando…"
                      className="w-full"
                    >
                      <XCircle size={14} /> Cerrar atención
                    </ActionSubmit>
                  </ActionForm>
                ) : (
                  <p className="text-xs text-warning">
                    La campaña aún no tiene tipificaciones de cierre.
                  </p>
                )}
              </ContextSection>

              <ContextSection title="Contexto comercial" icon={Megaphone}>
                <ContextRow label="Campaña">
                  {campaign?.name ?? "Sin campaña"}
                </ContextRow>
                <ContextRow label="Cola">
                  {queue?.name ?? "Sin cola"}
                </ContextRow>
                <ContextRow label="Canal">
                  {canalDeMensajeria(selected.canal) === "whatsapp" ? "WhatsApp Business" : NOMBRE_DEL_CANAL[canalDeMensajeria(selected.canal)]}
                </ContextRow>
                <ContextRow label="Cuenta">
                  {channel?.cuenta ?? channel?.business_name ?? "Meta"}
                </ContextRow>
                {channel?.display_phone_number && (
                  <ContextRow label="Línea">{channel.display_phone_number}</ContextRow>
                )}
                {permissions.canMonitorOperations && queue && (
                  <Link
                    href={`/dashboard/operacion?queue=${queue.id}&channel=whatsapp`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Ver operación de cola <ArrowUpRight size={12} />
                  </Link>
                )}
                {(referralHeadline || referralBody) && (
                  <div className="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span className="icon-chip size-5 rounded-md" data-tone="rose" aria-hidden="true">
                        <Megaphone size={11} />
                      </span>
                      Origen Meta Ads
                    </p>
                    {referralHeadline && (
                      <p className="mt-1 text-xs font-medium text-foreground">
                        {referralHeadline}
                      </p>
                    )}
                    {referralBody && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {referralBody}
                      </p>
                    )}
                  </div>
                )}
              </ContextSection>

              <ContextSection title="Registro 360" icon={UserRound}>
                <ContextRow label="Contacto">
                  {lead?.full_name ?? selected.contact_name ?? "—"}
                </ContextRow>
                <ContextRow label="RUT">{lead?.rut ?? "—"}</ContextRow>
                <ContextRow label="Teléfono">
                  {lead?.phone ?? selected.contact_phone ?? "—"}
                </ContextRow>
                <ContextRow label="Correo">{lead?.email ?? "—"}</ContextRow>
                <ContextRow label="Estado">
                  {lead?.status ? (LEAD_STATUS_LABEL.get(lead.status) ?? fieldLabel(lead.status)) : "—"}
                </ContextRow>
                <ContextRow label="Tipificación">
                  {lead?.tipificacion_actual ? enOracion(lead.tipificacion_actual) : "Sin tipificar"}
                </ContextRow>
                <ContextRow label="Próxima acción">
                  {formatDateTime(lead?.next_action_at)}
                </ContextRow>
              </ContextSection>

              <ContextSection title="Gestión" icon={ClipboardList}>
                <ContextRow label="Responsable">
                  {assigned?.full_name ?? "Sin asignar"}
                </ContextRow>
                {permissions.canAttendCustomers &&
                  humanAttentionReady &&
                  selected.unread_count > 0 && (
                    <ActionForm
                      action={markWhatsAppConversationRead}
                      success="Conversación marcada como leída"
                    >
                      <input
                        type="hidden"
                        name="conversation_id"
                        value={selected.id}
                      />
                      <ActionSubmit
                        variant="secondary"
                        size="sm"
                        pendingLabel="Guardando…"
                        className="w-full"
                      >
                        <CheckCheck size={14} /> Marcar leída
                      </ActionSubmit>
                    </ActionForm>
                  )}
                {permissions.canAttendCustomers &&
                  humanAttentionReady &&
                  (selected.status === "closed" ? (
                    <ActionForm
                      action={setWhatsAppConversationStatus}
                      success="Atención reabierta"
                    >
                      <input
                        type="hidden"
                        name="conversation_id"
                        value={selected.id}
                      />
                      <input type="hidden" name="status" value="open" />
                      <ActionSubmit
                        variant="secondary"
                        size="sm"
                        pendingLabel="Reabriendo…"
                        className="w-full"
                      >
                        Reabrir atención
                      </ActionSubmit>
                    </ActionForm>
                  ) : (
                    <ActionForm
                      action={setWhatsAppConversationStatus}
                      success="Estado actualizado"
                      className="space-y-2"
                    >
                      <input
                        type="hidden"
                        name="conversation_id"
                        value={selected.id}
                      />
                      <Select
                        name="status"
                        defaultValue={selected.status}
                        fieldSize="sm"
                        className="w-full"
                      >
                        <option value="open">Abierta</option>
                        <option value="pending">Pendiente</option>
                      </Select>
                      <ActionSubmit
                        variant="secondary"
                        size="sm"
                        pendingLabel="Guardando…"
                        className="w-full"
                      >
                        Guardar estado
                      </ActionSubmit>
                    </ActionForm>
                  ))}
                {canManage && (
                  <ActionForm
                    action={assignWhatsAppConversation}
                    success="Responsable actualizado"
                    className="space-y-2"
                  >
                    <input
                      type="hidden"
                      name="conversation_id"
                      value={selected.id}
                    />
                    <Select
                      name="agent_id"
                      defaultValue={selected.assigned_to ?? ""}
                      fieldSize="sm"
                      className="w-full"
                    >
                      <option value="">Sin asignar</option>
                      {agentOptions.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.full_name}
                        </option>
                      ))}
                    </Select>
                    <ActionSubmit
                      variant="secondary"
                      size="sm"
                      pendingLabel="Asignando…"
                      className="w-full"
                    >
                      <UserRound size={14} /> Asignar responsable
                    </ActionSubmit>
                  </ActionForm>
                )}
              </ContextSection>

              <ContextSection title="Asistente IA" icon={Bot}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Bot size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        Mercury 2
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {automationError
                          ? "Estado de automatización no disponible"
                          : !aiConfig
                            ? "IA no configurada · requiere revisión administrativa"
                            : !aiConfig.enabled
                              ? "Pausada por control general"
                              : selected.ai_state === "auto"
                                ? "IA atendiendo hasta derivación"
                                : selected.ai_state === "handoff"
                                  ? "Derivado a atención humana"
                                  : "Control humano"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    tone={
                      aiConfig?.enabled && selected.ai_state === "auto"
                        ? "success"
                        : selected.ai_state === "handoff"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {automationError
                      ? "Sin verificar"
                      : !aiConfig
                        ? "No configurada"
                        : !aiConfig.enabled
                          ? "Pausa general"
                          : selected.ai_state === "auto"
                            ? "IA atendiendo"
                            : "Atención humana"}
                  </Badge>
                </div>
                {selected.ai_state === "handoff" && handoffEvent && (
                  <div className="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                    <Badge tone="warning">{handoffKindLabel(handoffEvent.metadata?.kind)}</Badge>
                    {handoffEvent.note && (
                      <p className="mt-1 text-xs text-foreground">
                        {handoffEvent.note}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Asignada a {assigned?.full_name ?? "la cola humana"} ·{" "}
                      {formatDateTime(handoffEvent.created_at)}
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  La automatización se administra de forma general. Una
                  conversación derivada permanece en atención humana.
                </p>
                {selected.ai_last_error && (
                  <p className="text-xs text-danger">
                    {selected.ai_last_error}
                  </p>
                )}
              </ContextSection>

              {dynamicData.length > 0 && (
                <ContextSection title="Datos de campaña" icon={Database}>
                  {dynamicData.map(([key, value]) => (
                    <ContextRow key={key} label={fieldLabel(key)}>
                      {String(value)}
                    </ContextRow>
                  ))}
                </ContextSection>
              )}

              <ContextSection title="Actividad omnicanal" icon={History}>
                {(lead360?.timeline ?? []).slice(0, 4).map((item) => {
                  const Icon = item.source === "call" ? Phone : MessageSquare;
                  return (
                    <div
                      key={`${item.source}-${item.id}`}
                      className="flex gap-2.5"
                    >
                      <span
                        className="icon-chip size-7 rounded-lg"
                        data-tone={item.source === "call" ? "primary" : "teal"}
                        aria-hidden="true"
                      >
                        <Icon size={13} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {item.title ? enOracion(item.title) : sourceLabel(item.source)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.agent_name} · {formatDateTime(item.occurred_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {(lead360?.timeline.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Aún no hay actividad previa.
                  </p>
                )}
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarClock size={12} />{" "}
                  {lead360?.summary.timeline_count ?? 0} gestiones previas ·{" "}
                  {messages.length} mensajes en este hilo
                </p>
              </ContextSection>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
