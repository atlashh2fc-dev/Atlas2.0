import Link from "next/link";
import { ArrowUpRight, CheckCheck, MessageCircle, Send, UserRound } from "lucide-react";

import {
  assignWhatsAppConversation,
  markWhatsAppConversationRead,
  sendWhatsAppMessage,
  setWhatsAppConversationStatus,
} from "@/app/actions/whatsapp";
import { WhatsAppAutoRefresh } from "@/components/whatsapp-auto-refresh";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  EmptyState,
  PageHeader,
  Select,
  buttonClasses,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Relation<T> = T | T[] | null;
type ConversationStatus = "open" | "pending" | "closed";

type Conversation = {
  id: string;
  campaign_id: string;
  lead_id: string;
  contact_name: string | null;
  contact_phone: string;
  assigned_to: string | null;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  referral: Record<string, unknown>;
  campaigns: Relation<{ id: string; name: string }>;
  leads: Relation<{ id: string; full_name: string; phone: string | null }>;
  profiles: Relation<{ id: string; full_name: string }>;
  whatsapp_channels: Relation<{ status: string }>;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text_body: string | null;
  status: string;
  provider_timestamp: string | null;
  created_at: string;
  error_message: string | null;
  profiles: Relation<{ full_name: string }>;
};

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  return status === "open" ? "Abierta" : status === "pending" ? "Pendiente" : "Cerrada";
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; status?: string }>;
}) {
  const profile = await requireProfile();
  const { conversation: requestedConversation, status: statusParam } = await searchParams;
  const status = (["open", "pending", "closed", "all"] as const).includes(
    statusParam as ConversationStatus | "all",
  )
    ? (statusParam as ConversationStatus | "all")
    : "open";
  const supabase = await createClient();

  let conversationQuery = supabase
    .from("whatsapp_conversations")
    .select(
      "id, campaign_id, lead_id, contact_name, contact_phone, assigned_to, status, unread_count, last_message_at, last_inbound_at, last_outbound_at, referral, campaigns(id, name), leads(id, full_name, phone), profiles(id, full_name), whatsapp_channels(status)",
    )
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (status !== "all") conversationQuery = conversationQuery.eq("status", status);

  const { data: conversationData, error: conversationError } = await conversationQuery;
  const conversations = (conversationData ?? []) as Conversation[];
  const selectedId = conversations.some((item) => item.id === requestedConversation)
    ? requestedConversation!
    : conversations[0]?.id ?? null;
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const [{ data: messageData }, { data: membershipData }] = selected
    ? await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("id, direction, message_type, text_body, status, provider_timestamp, created_at, error_message, profiles(full_name)")
          .eq("conversation_id", selected.id)
          .order("provider_timestamp", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .limit(500),
        profile.role === "agente"
          ? Promise.resolve({ data: [] })
          : supabase
              .from("campaign_agents")
              .select("profile_id, profiles!inner(id, full_name, active, role)")
              .eq("campaign_id", selected.campaign_id)
              .eq("profiles.active", true)
              .eq("profiles.role", "agente"),
      ])
    : [{ data: [] }, { data: [] }];
  const messages = (messageData ?? []) as Message[];
  const agentOptions = (membershipData ?? []).flatMap((membership) => {
    const agent = one((membership as { profiles: Relation<{ id: string; full_name: string }> }).profiles);
    return agent ? [agent] : [];
  });
  const canManage = profile.role === "supervisor" || profile.role === "admin";
  const channel = selected ? one(selected.whatsapp_channels) : null;
  const sendReady = channel?.status === "active";
  const referral = selected?.referral ?? {};
  const referralHeadline = typeof referral.headline === "string" ? referral.headline : null;
  const referralBody = typeof referral.body === "string" ? referral.body : null;

  return (
    <div className="space-y-5">
      <WhatsAppAutoRefresh conversationId={selectedId} />
      <PageHeader
        title="Conversaciones"
        description="WhatsApp de campañas: contacto, responsable y gestión en una sola bandeja."
      />

      {conversationError ? (
        <Callout tone="warning">
          La bandeja está preparada, pero falta aplicar la migración de WhatsApp: {conversationError.message}
        </Callout>
      ) : (
        <div className="grid min-h-[calc(100vh-12rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-sm lg:grid-cols-[22rem_1fr]">
          <aside className="border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex gap-1 border-b border-border p-3">
              {(["open", "pending", "closed", "all"] as const).map((value) => (
                <Link
                  key={value}
                  href={`/dashboard/conversaciones?status=${value}`}
                  className={buttonClasses({
                    variant: status === value ? "primary" : "ghost",
                    size: "sm",
                    className: "flex-1",
                  })}
                >
                  {value === "open" ? "Abiertas" : value === "pending" ? "Pendientes" : value === "closed" ? "Cerradas" : "Todas"}
                </Link>
              ))}
            </div>
            <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="p-5 text-center text-sm text-muted-foreground">No hay conversaciones en esta vista.</div>
              ) : (
                conversations.map((conversation) => {
                  const campaign = one(conversation.campaigns);
                  const assigned = one(conversation.profiles);
                  return (
                    <Link
                      key={conversation.id}
                      href={`/dashboard/conversaciones?status=${status}&conversation=${conversation.id}`}
                      className={cn(
                        "block border-b border-border p-4 transition-colors hover:bg-surface-muted",
                        selectedId === conversation.id && "bg-surface-muted",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {conversation.contact_name || conversation.contact_phone}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign?.name ?? "Sin campaña"}</p>
                        </div>
                        {conversation.unread_count > 0 && (
                          <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold text-primary-foreground">
                            {conversation.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{assigned?.full_name ?? "Sin asignar"}</span>
                        <span className="whitespace-nowrap">{formatDateTime(conversation.last_message_at)}</span>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            {!selected ? (
              <EmptyState
                icon={MessageCircle}
                title="Selecciona una conversación"
                description="Los mensajes nuevos aparecerán aquí en tiempo real."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {selected.contact_name || selected.contact_phone}
                      </h2>
                      <Badge tone={selected.status === "closed" ? "neutral" : selected.status === "pending" ? "warning" : "success"}>
                        {conversationLabel(selected.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{selected.contact_phone}</p>
                    <Link
                      href={`/dashboard/leads/${selected.lead_id}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Abrir ficha del lead <ArrowUpRight size={12} />
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {selected.unread_count > 0 && (
                      <ActionForm action={markWhatsAppConversationRead} success="Conversación marcada como leída">
                        <input type="hidden" name="conversation_id" value={selected.id} />
                        <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                          <CheckCheck size={14} /> Marcar leída
                        </ActionSubmit>
                      </ActionForm>
                    )}
                    <ActionForm action={setWhatsAppConversationStatus} success="Estado actualizado" className="flex gap-2">
                      <input type="hidden" name="conversation_id" value={selected.id} />
                      <Select name="status" defaultValue={selected.status} fieldSize="sm">
                        <option value="open">Abierta</option>
                        <option value="pending">Pendiente</option>
                        <option value="closed">Cerrada</option>
                      </Select>
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">Guardar</ActionSubmit>
                    </ActionForm>
                    {canManage && (
                      <ActionForm action={assignWhatsAppConversation} success="Responsable actualizado" className="flex gap-2">
                        <input type="hidden" name="conversation_id" value={selected.id} />
                        <Select name="agent_id" defaultValue={selected.assigned_to ?? ""} fieldSize="sm">
                          <option value="">Sin asignar</option>
                          {agentOptions.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.full_name}</option>
                          ))}
                        </Select>
                        <ActionSubmit variant="secondary" size="sm" pendingLabel="Asignando…">
                          <UserRound size={14} /> Asignar
                        </ActionSubmit>
                      </ActionForm>
                    )}
                  </div>
                </div>

                {(referralHeadline || referralBody) && (
                  <div className="border-b border-border bg-surface-muted px-4 py-3 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Origen Meta Ads</p>
                    {referralHeadline && <p className="mt-1 font-medium text-foreground">{referralHeadline}</p>}
                    {referralBody && <p className="mt-0.5 text-muted-foreground">{referralBody}</p>}
                  </div>
                )}

                <div className="flex-1 space-y-3 overflow-y-auto bg-background p-4">
                  {messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay mensajes guardados.</p>
                  ) : (
                    messages.map((message) => {
                      const sender = one(message.profiles);
                      const outbound = message.direction === "outbound";
                      return (
                        <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm",
                              outbound ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-foreground",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">
                              {message.text_body || `[${message.message_type}]`}
                            </p>
                            <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", outbound ? "text-primary-foreground/75" : "text-muted-foreground")}>
                              {outbound && sender?.full_name && <span>{sender.full_name} ·</span>}
                              <span>{formatDateTime(message.provider_timestamp ?? message.created_at)}</span>
                              <span>· {messageStatus(message.status)}</span>
                            </div>
                            {message.error_message && <p className="mt-1 text-xs text-danger">{message.error_message}</p>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-border bg-surface p-4">
                  {!sendReady && (
                    <p className="mb-2 text-xs text-warning">
                      La lectura está disponible; falta terminar la autorización del proveedor para responder desde Atlas.
                    </p>
                  )}
                  <ActionForm action={sendWhatsAppMessage} success="Mensaje enviado" className="flex items-end gap-2">
                    <input type="hidden" name="conversation_id" value={selected.id} />
                    <textarea
                      name="body"
                      rows={2}
                      maxLength={4096}
                      required
                      disabled={!sendReady}
                      placeholder="Escribe una respuesta…"
                      className="min-h-16 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    />
                    <ActionSubmit disabled={!sendReady} pendingLabel="Enviando…">
                      <Send size={15} /> Enviar
                    </ActionSubmit>
                  </ActionForm>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
