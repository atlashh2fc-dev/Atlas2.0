import Link from "next/link";
import { ArrowUpRight, Bot, Clock3, MessageCircle, MessagesSquare, UserRoundCheck, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";

import { assignWhatsAppConversation } from "@/app/actions/whatsapp";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  MetricCard,
  SectionCard,
  Select,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  buttonClasses,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;
type MemberMetric = { profile_id: string; full_name: string; active: boolean; active_interactions: number; unread: number; handoffs: number; closed_in_period: number; last_activity_at: string | null };
type ClosureMetric = { id: string; label: string; total: number };
type ControlData = {
  queue: { active: number; open: number; pending: number; closed: number; unassigned: number; unread: number; handoff: number };
  period: { offered: number; closed: number; inbound_messages: number; outbound_messages: number; avg_answer_seconds: number | null; avg_handle_seconds: number | null };
  members: MemberMetric[];
  closures: ClosureMetric[];
};
type QueueConversation = { id: string; campaign_id: string; contact_name: string | null; contact_phone: string; assigned_to: string | null; status: "open" | "pending"; unread_count: number; ai_state: "auto" | "paused" | "handoff"; last_message_at: string; last_inbound_at: string | null; last_outbound_at: string | null; profiles: Relation<{ id: string; full_name: string }>; campaigns: Relation<{ name: string }> };

const EMPTY_CONTROL: ControlData = { queue: { active: 0, open: 0, pending: 0, closed: 0, unassigned: 0, unread: 0, handoff: 0 }, period: { offered: 0, closed: 0, inbound_messages: 0, outbound_messages: 0, avg_answer_seconds: null, avg_handle_seconds: null }, members: [], closures: [] };

function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function normalizeControl(value: unknown): ControlData {
  if (!value || typeof value !== "object") return EMPTY_CONTROL;
  const raw = value as Partial<ControlData>;
  return { queue: { ...EMPTY_CONTROL.queue, ...(raw.queue ?? {}) }, period: { ...EMPTY_CONTROL.period, ...(raw.period ?? {}) }, members: Array.isArray(raw.members) ? raw.members : [], closures: Array.isArray(raw.closures) ? raw.closures : [] };
}
function formatDateTime(value: string | null) { return value ? new Date(value).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }
function formatDuration(seconds: number | null) { if (seconds === null || !Number.isFinite(seconds)) return "—"; const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`; }
function waitingMinutes(conversation: QueueConversation, nowMs: number) { if (!conversation.last_inbound_at) return null; if (conversation.last_outbound_at && new Date(conversation.last_outbound_at).getTime() >= new Date(conversation.last_inbound_at).getTime()) return null; return Math.max(0, Math.floor((nowMs - new Date(conversation.last_inbound_at).getTime()) / 60_000)); }

export default async function ContactCenterQueuePage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const now = new Date();
  const nowMs = now.getTime();
  const periodStart = new Date(now); periodStart.setDate(periodStart.getDate() - 30);
  const [queueResult, sourcesResult, controlResult, conversationsResult, membersResult] = await Promise.all([
    supabase.from("contact_center_queues").select("id, name, description, is_active, routing_mode, service_level_seconds, max_concurrent_per_agent").eq("id", id).maybeSingle(),
    supabase.from("contact_center_queue_sources").select("channel_type, campaign_id, campaigns(name), whatsapp_campaign_routes(whatsapp_channels(display_phone_number, business_name, status))").eq("queue_id", id).eq("is_active", true),
    supabase.rpc("get_contact_center_queue_control", { p_queue_id: id, p_from: periodStart.toISOString() }),
    supabase.from("whatsapp_conversations").select("id, campaign_id, contact_name, contact_phone, assigned_to, status, unread_count, ai_state, last_message_at, last_inbound_at, last_outbound_at, profiles:profiles!whatsapp_conversations_assigned_to_fkey(id, full_name), campaigns(name)").eq("queue_id", id).in("status", ["open", "pending"]).order("last_message_at", { ascending: false }).limit(250),
    supabase.from("contact_center_queue_members").select("profile_id, profiles!inner(id, full_name)").eq("queue_id", id).eq("is_active", true).order("joined_at"),
  ]);
  if (!queueResult.data) notFound();

  const queueConfig = queueResult.data;
  const control = normalizeControl(controlResult.data);
  const conversations = (conversationsResult.data ?? []) as QueueConversation[];
  const agentOptions = (membersResult.data ?? []).flatMap((member) => { const profile = one(member.profiles as Relation<{ id: string; full_name: string }>); return profile ? [profile] : []; });
  const serviceLevelMinutes = Math.round(queueConfig.service_level_seconds / 60);
  const outsideSla = conversations.filter((conversation) => { const wait = waitingMinutes(conversation, nowMs); return wait !== null && wait * 60 >= queueConfig.service_level_seconds; }).length;
  const campaignIds = [...new Set((sourcesResult.data ?? []).map((source) => source.campaign_id).filter(Boolean))];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Interacciones en cola" value={control.queue.active} hint={`${control.queue.open} abiertas · ${control.queue.pending} pendientes`} />
        <MetricCard label="Sin asignar" value={control.queue.unassigned} tone={control.queue.unassigned > 0 ? "warn" : "good"} />
        <MetricCard label="No leídas" value={control.queue.unread} tone={control.queue.unread > 0 ? "warn" : "good"} />
        <MetricCard label="Fuera de SLA" value={outsideSla} tone={outsideSla > 0 ? "danger" : "good"} hint={`Objetivo ${serviceLevelMinutes} min`} />
        <MetricCard label="Derivadas por IA" value={control.queue.handoff} tone={control.queue.handoff > 0 ? "warn" : "default"} />
        <MetricCard label="Agentes disponibles" value={control.members.filter((member) => member.active).length} hint={control.members.length > 0 ? `${control.members.length} miembros` : "Configura la membresía"} href={`/dashboard/admin/colas/${id}/miembros`} hrefLabel="Gestionar miembros" tone={control.members.length > 0 ? "good" : "warn"} />
      </div>

      <SectionCard title="Interacciones en espera" description="La cola reúne fuentes y campañas; el agente recibe una interacción con todo su contexto CRM." actions={campaignIds[0] ? <Link href={`/dashboard/conversaciones?status=all&campaign=${campaignIds[0]}`} className={buttonClasses({ variant: "primary", size: "sm" })}>Abrir escritorio <ArrowUpRight size={13} /></Link> : null}>
          <div className="max-h-[34rem] overflow-auto"><Table><Thead><Th>Contacto y origen</Th><Th>Espera</Th><Th>Estado</Th><Th>Responsable</Th><Th className="text-right">Asignación</Th></Thead><Tbody>
            {conversations.length === 0 && <TableEmpty colSpan={5}>La cola está limpia.</TableEmpty>}
            {conversations.map((conversation) => { const assigned = one(conversation.profiles); const campaign = one(conversation.campaigns); const wait = waitingMinutes(conversation, nowMs); const late = wait !== null && wait * 60 >= queueConfig.service_level_seconds; return <Tr key={conversation.id}>
              <Td strong className="min-w-56"><Link href={`/dashboard/conversaciones?status=all&campaign=${conversation.campaign_id}&conversation=${conversation.id}`} className="hover:text-primary hover:underline">{conversation.contact_name || conversation.contact_phone}</Link><p className="mt-0.5 text-xs font-normal text-muted-foreground">{campaign?.name ?? "Sin campaña"} · {formatDateTime(conversation.last_message_at)}</p></Td>
              <Td><span className={late ? "font-semibold text-danger" : "text-muted-foreground"}>{wait === null ? "Al día" : `${wait} min`}</span></Td>
              <Td><div className="flex flex-wrap gap-1"><Badge tone={conversation.status === "open" ? "success" : "warning"}>{conversation.status === "open" ? "Abierta" : "Pendiente"}</Badge>{conversation.unread_count > 0 && <Badge tone="info">{conversation.unread_count} nueva{conversation.unread_count === 1 ? "" : "s"}</Badge>}{conversation.ai_state === "handoff" && <Badge tone="warning">IA derivó</Badge>}</div></Td>
              <Td>{assigned?.full_name ?? <span className="text-warning">Sin asignar</span>}</Td>
              <Td className="min-w-64"><ActionForm action={assignWhatsAppConversation} success="Responsable actualizado" className="flex items-center justify-end gap-2"><input type="hidden" name="conversation_id" value={conversation.id} /><Select name="agent_id" defaultValue={conversation.assigned_to ?? ""} fieldSize="sm" className="max-w-40"><option value="">Sin asignar</option>{agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</Select><ActionSubmit variant="secondary" size="sm" pendingLabel="…">Asignar</ActionSubmit></ActionForm></Td>
            </Tr>; })}
          </Tbody></Table></div>
      </SectionCard>

      <SectionCard title="Carga de agentes" description="Estado actual y producción de los últimos 30 días."><div className="overflow-x-auto"><Table><Thead><Th>Agente</Th><Th align="right">Activas</Th><Th align="right">No leídas</Th><Th align="right">Derivadas IA</Th><Th align="right">Cerradas</Th><Th>Actividad</Th></Thead><Tbody>
          {control.members.length === 0 && <TableEmpty colSpan={6}>La cola no tiene miembros activos.</TableEmpty>}
          {control.members.map((member) => <Tr key={member.profile_id}><Td strong><span className="inline-flex items-center gap-2"><UserRoundCheck size={15} className={member.active ? "text-success" : "text-muted-foreground"} />{member.full_name}</span></Td><Td align="right">{member.active_interactions}</Td><Td align="right">{member.unread}</Td><Td align="right">{member.handoffs}</Td><Td align="right">{member.closed_in_period}</Td><Td muted>{formatDateTime(member.last_activity_at)}</Td></Tr>)}
      </Tbody></Table></div></SectionCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <SectionCard title="Performance de cola · 30 días" description="Métricas ACD comparables entre canales y fuentes."><div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label={<span className="inline-flex items-center gap-1"><UsersRound size={13} /> Ofrecidas</span>} value={control.period.offered} />
          <MetricCard label={<span className="inline-flex items-center gap-1"><MessagesSquare size={13} /> Mensajes recibidos</span>} value={control.period.inbound_messages} hint={`${control.period.outbound_messages} respuestas`} />
          <MetricCard label={<span className="inline-flex items-center gap-1"><Clock3 size={13} /> Tiempo de respuesta</span>} value={formatDuration(control.period.avg_answer_seconds)} />
          <MetricCard label={<span className="inline-flex items-center gap-1"><MessageCircle size={13} /> Cerradas</span>} value={control.period.closed} />
          <MetricCard label={<span className="inline-flex items-center gap-1"><Clock3 size={13} /> Tiempo de gestión</span>} value={formatDuration(control.period.avg_handle_seconds)} />
          <MetricCard label={<span className="inline-flex items-center gap-1"><Bot size={13} /> Derivadas por IA</span>} value={control.queue.handoff} hint="Stock actual" />
        </div></SectionCard>
        <SectionCard title="Wrap-up / tipificaciones" description="Distribución de cierres de los últimos 30 días."><div className="divide-y divide-border">{control.closures.length === 0 && <p className="p-4 text-sm text-muted-foreground">Aún no hay cierres tipificados.</p>}{control.closures.map((reason) => <div key={reason.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{reason.label}</span><span className="font-semibold tabular-nums">{reason.total}</span></div>)}</div></SectionCard>
      </div>
    </div>
  );
}
