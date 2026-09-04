import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  Bot,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { setWhatsAppAutomationEnabled } from "@/app/actions/whatsapp";
import { OperationsRefresh } from "@/components/operations-refresh";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  Card,
  PageHeader,
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
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { loadOperationalConversations } from "@/lib/operations-data";
import {
  formatOperationalAge,
  parseOperationFilters,
  summarizeConversationStock,
} from "@/lib/operations-model";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";

type Relation<T> = T | T[] | null;
type Queue = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  routing_mode: string;
  max_concurrent_per_agent: number | null;
  service_level_seconds: number;
};
type Campaign = { id: string; name: string };
type Source = {
  queue_id: string;
  campaign_id: string | null;
  channel_type: string;
  is_active: boolean;
  whatsapp_campaign_routes: Relation<{
    whatsapp_channels: Relation<{ status: string }>;
  }>;
};
type Member = {
  queue_id: string;
  profile_id: string;
  max_concurrent: number | null;
  profiles: Relation<{ id: string; full_name: string; active: boolean }>;
};
type AutomationChange = {
  id: string;
  created_at: string;
  previous_enabled: boolean;
  enabled: boolean;
  campaigns: Relation<{ name: string }>;
  profiles: Relation<{ full_name: string }>;
};
type MailReportRow = {
  mail_campaign_id: string | null;
  mail_campaign_name: string;
  campaign_id: string;
  campaign_name: string;
  sent_leads: number;
  opened_leads: number;
  clicked_leads: number;
  hot_leads: number;
  assigned_hot_leads: number;
  managed_hot_leads: number;
};
const one = <T,>(value: Relation<T>): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

function DataNumber({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string | null;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value ?? "No disponible"}
      </dd>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function phoneState(agent: AgentLiveStatus) {
  if (agent.phone_status === "on_call") return "En llamada";
  if (agent.phone_status === "ringing") return "Sonando";
  if (agent.phone_status === "wrap_up") return "Cierre de llamada";
  if (agent.phone_status === "offline" || agent.reason_code === "desconectado")
    return "Desconectado";
  if (agent.is_pause) return agent.reason_label || "En pausa";
  return agent.phone_status === "available"
    ? "Disponible para voz"
    : "Sin estado";
}

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const permissions = getWorkspacePermissions(profile.role);
  if (!permissions.canMonitorOperations) redirect("/dashboard");
  const filters = parseOperationFilters(await searchParams);
  const showVoice = filters.channel === "all" || filters.channel === "voice";
  const showWhatsApp = filters.channel === "all" || filters.channel === "whatsapp";
  const showMail = filters.channel === "all" || filters.channel === "email";
  const supabase = await createClient();
  const [
    queuesResult,
    sourcesResult,
    membersResult,
    campaignsResult,
    voiceResult,
    agentsResult,
    mailResult,
    stockResult,
    automationResult,
    automationHistoryResult,
  ] = await Promise.all([
    supabase
      .from("contact_center_queues")
      .select(
        "id, name, description, is_active, routing_mode, max_concurrent_per_agent, service_level_seconds",
        { count: "exact" },
      )
      .order("name")
      .limit(1000),
    supabase
      .from("contact_center_queue_sources")
      .select(
        "queue_id, campaign_id, channel_type, is_active, whatsapp_campaign_routes(whatsapp_channels(status))",
        { count: "exact" },
      )
      .limit(1000),
    supabase
      .from("contact_center_queue_members")
      .select(
        "queue_id, profile_id, max_concurrent, profiles(id, full_name, active)",
        { count: "exact" },
      )
      .eq("is_active", true)
      .limit(1000),
    supabase
      .from("campaigns")
      .select("id, name", { count: "exact" })
      .order("name")
      .limit(1000),
    supabase.rpc("get_queue_health"),
    supabase.rpc("get_agent_live_status"),
    showMail
      ? supabase.rpc("get_mail_engagement_report_read_model", {
          p_mail_campaign_id: null,
          p_campaign_id: null,
        })
      : Promise.resolve({ data: null, error: null }),
    !showWhatsApp
      ? Promise.resolve({ data: null, error: null })
      : loadOperationalConversations(supabase, {
          campaign: "",
          queue: filters.queue,
        }),
    supabase
      .from("whatsapp_ai_configs")
      .select("campaign_id, enabled", { count: "exact" })
      .limit(1000),
    supabase
      .from("whatsapp_automation_changes")
      .select(
        "id, created_at, previous_enabled, enabled, campaigns(name), profiles!whatsapp_automation_changes_actor_id_fkey(full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const observedAt = new Date().toISOString();
  const now = Date.parse(observedAt);
  const catalogUnavailable = Boolean(
    queuesResult.error ||
    sourcesResult.error ||
    campaignsResult.error ||
    (queuesResult.count ?? 0) > 1000 ||
    (sourcesResult.count ?? 0) > 1000 ||
    (campaignsResult.count ?? 0) > 1000,
  );
  const membersUnavailable = Boolean(
    membersResult.error || (membersResult.count ?? 0) > 1000,
  );
  const queues = (queuesResult.data ?? []) as Queue[];
  const sources = (sourcesResult.data ?? []) as Source[];
  const members = membersUnavailable
    ? []
    : ((membersResult.data ?? []) as Member[]);
  const campaigns = (campaignsResult.data ?? []) as Campaign[];
  const campaignNames = new Map(
    campaigns.map((campaign) => [campaign.id, campaign.name]),
  );
  const selectedQueue = filters.queue
    ? queues.find((queue) => queue.id === filters.queue)
    : null;
  const invalidSelection = Boolean(
    (filters.queue && !selectedQueue) ||
    (filters.campaign && !campaignNames.has(filters.campaign)),
  );
  const matchingQueues = queues.filter((queue) => {
    if (filters.queue && queue.id !== filters.queue) return false;
    if (
      filters.state !== "all" &&
      queue.is_active !== (filters.state === "active")
    )
      return false;
    const belongsToCampaign = !filters.campaign || sources.some(
      (source) =>
        source.queue_id === queue.id &&
        source.is_active &&
        source.campaign_id === filters.campaign,
    );
    if (!belongsToCampaign) return false;
    return (showWhatsApp && stockResult.data?.some((item) => item.queue_id === queue.id)) ||
      sources.some(
        (source) =>
          source.queue_id === queue.id &&
          source.is_active &&
          (filters.channel === "all" || source.channel_type === filters.channel),
      );
  });
  const allStock = stockResult.data;
  const matchingQueueIds = new Set(matchingQueues.map((queue) => queue.id));
  // La campaña selecciona su unidad operativa; no elimina los canales hermanos
  // que usan otra campaña interna dentro de la misma unidad.
  const filteredStock =
    allStock?.filter(
      (item) =>
        item.queue_id !== null && matchingQueueIds.has(item.queue_id),
    ) ?? null;
  const stock = filteredStock
    ? summarizeConversationStock(filteredStock)
    : null;
  const stockUnavailable =
    catalogUnavailable || invalidSelection || Boolean(stockResult.error);
  const automationUnavailable = Boolean(
    automationResult.error ||
    automationHistoryResult.error ||
    automationResult.count === null ||
    automationResult.count > 1000,
  );
  const automationConfigs = automationUnavailable
    ? []
    : (automationResult.data ?? []);
  const automationEnabled = automationConfigs.filter(
    (config) => config.enabled,
  ).length;
  const automationState = automationUnavailable
    ? "No disponible"
    : automationConfigs.length === 0
      ? "Sin configurar"
      : automationEnabled === 0
        ? "Pausada"
        : automationEnabled === automationConfigs.length
          ? "Activa"
          : "Mixta";
  const automationHistory = (automationHistoryResult.data ??
    []) as AutomationChange[];
  const mailCampaignIdsForQueue = new Set(
    sources
      .filter(
        (source) =>
          matchingQueueIds.has(source.queue_id) &&
          source.channel_type === "email" &&
          source.is_active &&
          source.campaign_id,
      )
      .map((source) => source.campaign_id as string),
  );
  const mailReports = ((mailResult.data ?? []) as MailReportRow[]).filter(
    (row) => mailCampaignIdsForQueue.has(row.campaign_id),
  );
  const mailUnavailable = Boolean(
    showMail && (mailResult.error || catalogUnavailable || invalidSelection),
  );
  const mailTotals = mailReports.reduce(
    (total, row) => ({
      sent: total.sent + Number(row.sent_leads ?? 0),
      opened: total.opened + Number(row.opened_leads ?? 0),
      clicked: total.clicked + Number(row.clicked_leads ?? 0),
      prioritized: total.prioritized + Number(row.hot_leads ?? 0),
      assigned: total.assigned + Number(row.assigned_hot_leads ?? 0),
      managed: total.managed + Number(row.managed_hot_leads ?? 0),
    }),
    { sent: 0, opened: 0, clicked: 0, prioritized: 0, assigned: 0, managed: 0 },
  );
  const voiceQueues = ((voiceResult.data ?? []) as QueueHealth[]).filter(
    (queue) => {
      if (filters.state === "inactive") return false; // The RPC explicitly returns active dialer campaigns.
      return sources.some(
        (source) =>
          matchingQueueIds.has(source.queue_id) &&
          source.channel_type === "voice" &&
          source.is_active &&
          source.campaign_id === queue.campaign_id,
      );
    },
  );
  const liveAgents = ((agentsResult.data ?? []) as AgentLiveStatus[]).filter(
    (agent) => {
      if (filters.state === "inactive") return false;
      return (
        members.some(
          (member) =>
            matchingQueueIds.has(member.queue_id) &&
            member.profile_id === agent.profile_id,
        ) ||
        sources.some(
          (source) =>
            matchingQueueIds.has(source.queue_id) &&
            source.channel_type === "voice" &&
            source.is_active &&
            source.campaign_id === agent.campaign_id,
        )
      );
    },
  );
  const voiceUnavailable = Boolean(
    voiceResult.error || catalogUnavailable || invalidSelection,
  );
  const agentsUnavailable = Boolean(
    agentsResult.error || (filters.queue && membersUnavailable),
  );
  const whatsappQueues = matchingQueues.filter(
    (queue) =>
      filteredStock?.some((item) => item.queue_id === queue.id) ||
      sources.some(
        (source) =>
          source.queue_id === queue.id &&
          source.channel_type === "whatsapp" &&
          source.is_active,
      ),
  );
  const stockByAgent = new Map<string, number>();
  for (const item of filteredStock ?? [])
    if (item.assigned_to)
      stockByAgent.set(
        item.assigned_to,
        (stockByAgent.get(item.assigned_to) ?? 0) + 1,
      );
  const waAgents = new Map<
    string,
    { name: string; enabled: boolean; queues: string[] }
  >();
  for (const member of members) {
    if (!whatsappQueues.some((queue) => queue.id === member.queue_id)) continue;
    const person = one(member.profiles);
    if (!person) continue;
    const current = waAgents.get(member.profile_id) ?? {
      name: person.full_name,
      enabled: person.active,
      queues: [],
    };
    current.queues.push(
      queues.find((queue) => queue.id === member.queue_id)?.name ?? "Cola",
    );
    waAgents.set(member.profile_id, current);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Centro de operaciones"
        description={
          permissions.canConfigurePlatform
            ? "Visibilidad global de colas, canales y capacidad configurada. Administración sin atención al cliente."
            : "Control de tus equipos y campañas autorizadas. Supervisa la carga sin asumir conversaciones."
        }
        actions={
          permissions.canConfigurePlatform ? (
            <Link
              href="/dashboard/admin/colas"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Configurar colas <ArrowUpRight size={14} />
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck size={14} /> Solo metadatos operativos · Sin contenido de
          conversaciones
        </span>
        <OperationsRefresh observedAt={observedAt} />
      </div>

      <Card>
        <form
          action="/dashboard/operacion"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium">
            Canal
            <Select
              name="channel"
              defaultValue={filters.channel}
              fieldSize="sm"
            >
              <option value="all">Voz, WhatsApp y correo</option>
              <option value="voice">Voz</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Correo</option>
            </Select>
          </label>
          <label className="flex min-w-48 flex-[2] flex-col gap-1 text-xs font-medium">
            Campaña
            <Select
              name="campaign"
              defaultValue={filters.campaign}
              fieldSize="sm"
            >
              <option value="">Todas las autorizadas</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-48 flex-[2] flex-col gap-1 text-xs font-medium">
            Unidad operativa
            <Select name="queue" defaultValue={filters.queue} fieldSize="sm">
              <option value="">Todas las autorizadas</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs font-medium">
            Estado de cola
            <Select name="state" defaultValue={filters.state} fieldSize="sm">
              <option value="all">Todos</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </Select>
          </label>
          <button
            type="submit"
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            Aplicar
          </button>
          <Link
            href="/dashboard/operacion"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            Limpiar
          </Link>
        </form>
      </Card>
      {catalogUnavailable && (
        <Callout tone="warning">
          El catálogo de colas o campañas no está disponible o excede el límite
          de consulta. No se presentan totales como si estuvieran completos.
        </Callout>
      )}
      {invalidSelection && !catalogUnavailable && (
        <Callout tone="warning">
          La campaña o cola seleccionada no está disponible para tu perfil.
          Limpia los filtros para consultar tu alcance autorizado.
        </Callout>
      )}
      {stockResult.error && showWhatsApp && (
        <Callout tone="warning">{stockResult.error}</Callout>
      )}

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Bot size={16} /> Automatización general de WhatsApp{" "}
            <Badge
              tone={
                automationState === "Activa"
                  ? "success"
                  : automationState === "Mixta"
                    ? "warning"
                    : "neutral"
              }
            >
              {automationState}
            </Badge>
          </span>
        }
        description={
          permissions.canConfigurePlatform
            ? "Control administrativo de todas las campañas configuradas. Este control no se limita por los filtros del monitor."
            : "Control general de todas las campañas configuradas dentro de tu alcance autorizado. No se limita por los filtros del monitor."
        }
      >
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">
            {automationUnavailable
              ? "No fue posible consultar el estado de automatización; el control está deshabilitado."
              : `${automationEnabled} de ${automationConfigs.length} campañas con automatización activa.`}{" "}
            La IA atiende hasta derivar a un ejecutivo. Activarla no retoma
            conversaciones ya transferidas a atención humana.
          </p>
          {!permissions.canConfigurePlatform && (
            <p className="text-xs text-muted-foreground">
              En campañas compartidas con equipos fuera de tu alcance, el cambio
              general requiere un administrador.
            </p>
          )}
          {automationHistoryResult.error && (
            <Callout tone="warning">
              No se pudo consultar la auditoría del control general. Verifica
              que la migración de roles esté aplicada y que tu cuenta tenga
              permisos. No se habilitan cambios sin esta verificación.
            </Callout>
          )}
          {!automationUnavailable && automationConfigs.length > 0 && (
            <ActionForm
              action={setWhatsAppAutomationEnabled}
              success="Control general de automatización actualizado"
              className="flex flex-wrap items-end gap-3"
            >
              <label className="flex min-w-64 flex-col gap-1 text-xs font-medium">
                Aplicar a todo el alcance
                <Select name="enabled" defaultValue="" required fieldSize="sm">
                  <option value="" disabled>
                    Seleccionar cambio general
                  </option>
                  <option value="true">Activar automatización general</option>
                  <option value="false">Pausar automatización general</option>
                </Select>
              </label>
              <label className="inline-flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <input type="checkbox" required /> Confirmo el cambio en las{" "}
                {automationConfigs.length} campañas de mi alcance
              </label>
              <ActionSubmit
                variant="secondary"
                size="sm"
                pendingLabel="Aplicando…"
              >
                Aplicar control general
              </ActionSubmit>
            </ActionForm>
          )}
          {!automationHistoryResult.error && (
            <details className="border-t border-border pt-3 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">
                Últimos cambios generales · hasta 10 registros de campaña
              </summary>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <Thead>
                    <Th>Fecha</Th>
                    <Th>Responsable</Th>
                    <Th>Campaña</Th>
                    <Th>Antes</Th>
                    <Th>Después</Th>
                  </Thead>
                  <Tbody>
                    {automationHistory.length === 0 ? (
                      <TableEmpty colSpan={5}>
                        No hay cambios generales registrados en tu alcance.
                      </TableEmpty>
                    ) : (
                      automationHistory.map((change) => (
                        <Tr key={change.id}>
                          <Td>
                            {new Date(change.created_at).toLocaleString(
                              "es-CL",
                              {
                                timeZone: "America/Santiago",
                                dateStyle: "short",
                                timeStyle: "short",
                              },
                            )}
                          </Td>
                          <Td>
                            {one(change.profiles)?.full_name ??
                              "Usuario registrado"}
                          </Td>
                          <Td>
                            {one(change.campaigns)?.name ??
                              "Campaña registrada"}
                          </Td>
                          <Td>
                            {change.previous_enabled ? "Activa" : "Pausada"}
                          </Td>
                          <Td>{change.enabled ? "Activa" : "Pausada"}</Td>
                        </Tr>
                      ))
                    )}
                  </Tbody>
                </Table>
              </div>
            </details>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Users size={16} />
            {matchingQueues.length === 1
              ? matchingQueues[0].name
              : "Unidades operativas"}
          </span>
        }
        description={
          matchingQueues.length === 1
            ? matchingQueues[0].description ?? "Operación omnicanal con sus canales y campañas internas."
            : "Cada unidad agrupa sus canales y campañas sin convertirlos en operaciones separadas."
        }
      >
        <div className="space-y-4 p-4">
          {matchingQueues.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {[...new Set(sources
                .filter((source) => matchingQueueIds.has(source.queue_id) && source.is_active)
                .map((source) => source.channel_type))]
                .map((channel) => (
                  <Badge key={channel} tone="neutral">
                    {channel === "voice" ? "Voz outbound" : channel === "whatsapp" ? "Meta WhatsApp" : channel === "email" ? "Correo" : channel}
                  </Badge>
                ))}
            </div>
          )}
      <div
        className={
          filters.channel === "all" ? "grid gap-4 xl:grid-cols-3" : "grid gap-4"
        }
      >
        {showWhatsApp && (
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <MessageCircle size={16} /> WhatsApp · Stock actual
              </span>
            }
            description="Conversaciones abiertas y pendientes; no equivale a chats activos ni a ocupación simultánea."
          >
            <dl className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
              <DataNumber
                label="Sin cerrar"
                value={stockUnavailable ? null : (stock?.total ?? null)}
              />
              <DataNumber
                label="Sin asignar"
                value={stockUnavailable ? null : (stock?.unassigned ?? null)}
              />
              <DataNumber
                label="Sin respuesta posterior"
                value={
                  stockUnavailable ? null : (stock?.awaitingResponse ?? null)
                }
              />
              <DataNumber
                label="Mayor antigüedad"
                value={
                  stockUnavailable
                    ? null
                    : formatOperationalAge(
                        stock?.oldestUnansweredAt ?? null,
                        now,
                      )
                }
                hint="Último inbound sin respuesta"
              />
            </dl>
          </SectionCard>
        )}
        {showVoice && (
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <Phone size={16} /> Voz · Operación actual
              </span>
            }
            description="Campañas activas del marcador. Las llamadas en curso no equivalen a personas esperando."
          >
            <dl className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
              <DataNumber
                label="En curso"
                value={
                  voiceUnavailable
                    ? null
                    : voiceQueues.reduce(
                        (total, queue) => total + queue.in_flight,
                        0,
                      )
                }
              />
              <DataNumber
                label="Campañas"
                value={voiceUnavailable ? null : voiceQueues.length}
              />
              <DataNumber
                label="Agentes disponibles"
                value={
                  agentsUnavailable || invalidSelection
                    ? null
                    : liveAgents.filter(
                        (agent) =>
                          agent.phone_status === "available" &&
                          !agent.is_pause &&
                          agent.reason_code !== "desconectado",
                      ).length
                }
              />
              <DataNumber
                label="Espera ACD en vivo"
                value="No disponible"
                hint="No expuesta por la fuente actual"
              />
            </dl>
          </SectionCard>
        )}
        {showMail && (
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                <Mail size={16} /> Correo · Operación actual
              </span>
            }
            description="Resultados y oportunidades de las campañas de correo conectadas a la cola seleccionada."
          >
            <dl className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
              <DataNumber label="Enviados" value={mailUnavailable ? null : mailTotals.sent} />
              <DataNumber label="Aperturas" value={mailUnavailable ? null : mailTotals.opened} />
              <DataNumber label="Clicks" value={mailUnavailable ? null : mailTotals.clicked} />
              <DataNumber
                label="Sin asignar"
                value={mailUnavailable ? null : Math.max(mailTotals.prioritized - mailTotals.assigned, 0)}
              />
            </dl>
          </SectionCard>
        )}
      </div>

      {showWhatsApp && (
        <SectionCard
          title="WhatsApp · detalle interno"
          description="Carga y estado del canal WhatsApp dentro de la unidad seleccionada."
        >
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Cola / campañas</Th>
                <Th>Estado</Th>
                <Th align="right">Sin cerrar</Th>
                <Th align="right">Sin asignar</Th>
                <Th align="right">Sin respuesta</Th>
                <Th>Antigüedad</Th>
                <Th align="right">Miembros habilitados</Th>
                <Th>Límite / agente</Th>
                <Th>Acción</Th>
              </Thead>
              <Tbody>
                {catalogUnavailable || invalidSelection ? (
                  <TableEmpty colSpan={9}>Catálogo no disponible.</TableEmpty>
                ) : whatsappQueues.length === 0 ? (
                  <TableEmpty colSpan={9}>
                    No hay colas de WhatsApp que coincidan con estos filtros.
                  </TableEmpty>
                ) : (
                  whatsappQueues.map((queue) => {
                    const queueStock = filteredStock
                      ? summarizeConversationStock(
                          filteredStock.filter(
                            (item) => item.queue_id === queue.id,
                          ),
                        )
                      : null;
                    const queueSources = sources.filter(
                      (source) =>
                        source.queue_id === queue.id &&
                        source.channel_type === "whatsapp",
                    );
                    const disabledChannels = queueSources.filter((source) => {
                      const route = one(source.whatsapp_campaign_routes);
                      return (
                        !source.is_active ||
                        !route ||
                        one(route.whatsapp_channels)?.status !== "active"
                      );
                    }).length;
                    const count = (value: number | undefined) =>
                      stockUnavailable ? "—" : (value ?? "—");
                    return (
                      <Tr key={queue.id}>
                        <Td strong className="min-w-64">
                          {queue.name}
                          <p className="mt-1 text-xs font-normal text-muted-foreground">
                            {[
                              ...new Set(
                                queueSources.map((source) =>
                                  source.campaign_id
                                    ? (campaignNames.get(source.campaign_id) ??
                                      "Campaña autorizada")
                                    : "Sin campaña",
                                ),
                              ),
                            ].join(" · ")}
                          </p>
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              !queue.is_active || disabledChannels > 0
                                ? "warning"
                                : "neutral"
                            }
                          >
                            {!queue.is_active
                              ? "Cola inactiva"
                              : disabledChannels > 0
                                ? "Revisar canal"
                                : "Cola activa"}
                          </Badge>
                        </Td>
                        <Td align="right">{count(queueStock?.total)}</Td>
                        <Td align="right">{count(queueStock?.unassigned)}</Td>
                        <Td align="right">
                          {count(queueStock?.awaitingResponse)}
                        </Td>
                        <Td>
                          {stockUnavailable
                            ? "—"
                            : formatOperationalAge(
                                queueStock?.oldestUnansweredAt ?? null,
                                now,
                              )}
                        </Td>
                        <Td align="right">
                          {membersUnavailable
                            ? "—"
                            : members.filter(
                                (member) =>
                                  member.queue_id === queue.id &&
                                  one(member.profiles)?.active,
                              ).length}
                        </Td>
                        <Td>
                          {queue.max_concurrent_per_agent ??
                            "Sin límite de cola"}
                          <p className="text-xs text-muted-foreground">
                            {queue.routing_mode === "manual"
                              ? "Asignación manual"
                              : "Menor carga"}
                          </p>
                        </Td>
                        <Td>
                          {permissions.canConfigurePlatform ? (
                            <Link
                              href={`/dashboard/admin/colas/${queue.id}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Configurar
                            </Link>
                          ) : (
                            <Link
                              href={`/dashboard/conversaciones/whatsapp?status=all&queue=${queue.id}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Supervisar asignaciones
                            </Link>
                          )}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>
          {!stockUnavailable &&
            (filteredStock?.some((item) => !item.queue_id) ?? false) && (
              <p className="border-t border-border px-4 py-3 text-xs text-warning">
                Hay {filteredStock!.filter((item) => !item.queue_id).length}{" "}
                conversaciones sin cola ACD. Están incluidas en el resumen, pero
                no en las filas de colas.
              </p>
            )}
        </SectionCard>
      )}

      {showVoice && (
        <SectionCard
          title="Voz outbound · detalle interno"
          description="Contadores de hoy según America/Santiago. Fuente: motor de discado; no incluye contenido ni grabaciones."
        >
          {voiceResult.error && (
            <Callout tone="warning">
              No fue posible consultar el motor de voz. Sus métricas no están
              disponibles.
            </Callout>
          )}
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Campaña</Th>
                <Th>Cola de voz</Th>
                <Th align="right">En curso</Th>
                <Th align="right">Intentos hoy</Th>
                <Th align="right">Contestadas hoy</Th>
                <Th align="right">Completadas hoy</Th>
                <Th>Espera ACD</Th>
              </Thead>
              <Tbody>
                {voiceUnavailable ? (
                  <TableEmpty colSpan={7}>
                    Datos de voz no disponibles.
                  </TableEmpty>
                ) : voiceQueues.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    {filters.state === "inactive"
                      ? "La fuente de voz informa únicamente campañas activas."
                      : "No hay campañas activas de voz que coincidan con estos filtros."}
                  </TableEmpty>
                ) : (
                  voiceQueues.map((queue) => (
                    <Tr key={queue.campaign_id}>
                      <Td strong>{queue.campaign_name}</Td>
                      <Td>{queue.queue_name || "Sin cola informada"}</Td>
                      <Td align="right">{queue.in_flight}</Td>
                      <Td align="right">{queue.attempts_today}</Td>
                      <Td align="right">{queue.answered_today}</Td>
                      <Td align="right">{queue.completed_today}</Td>
                      <Td muted>No disponible</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </SectionCard>
      )}

      {showMail && (
        <SectionCard
          title="Correo · detalle interno"
          description="Las oportunidades conservan su campaña y responsable CRM; la asignación se realiza sin duplicar contactos."
        >
          {mailResult.error && (
            <Callout tone="warning">
              No fue posible consultar la operación de correo.
            </Callout>
          )}
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Campaña</Th>
                <Th align="right">Enviados</Th>
                <Th align="right">Aperturas</Th>
                <Th align="right">Clicks</Th>
                <Th align="right">Asignados</Th>
                <Th align="right">Gestionados</Th>
                <Th>Acción</Th>
              </Thead>
              <Tbody>
                {mailUnavailable ? (
                  <TableEmpty colSpan={7}>Datos de correo no disponibles.</TableEmpty>
                ) : mailReports.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    No hay campañas de correo conectadas que coincidan con estos filtros.
                  </TableEmpty>
                ) : (
                  mailReports.map((report) => (
                    <Tr key={`${report.mail_campaign_id ?? report.campaign_id}-${report.campaign_id}`}>
                      <Td strong>{report.mail_campaign_name}</Td>
                      <Td align="right">{report.sent_leads}</Td>
                      <Td align="right">{report.opened_leads}</Td>
                      <Td align="right">{report.clicked_leads}</Td>
                      <Td align="right">{report.assigned_hot_leads}</Td>
                      <Td align="right">{report.managed_hot_leads}</Td>
                      <Td>
                        <Link
                          href={`/dashboard/mail?campaign=${report.campaign_id}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Gestionar correo
                        </Link>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Users size={16} /> Equipo omnicanal y carga por canal
          </span>
        }
        description="La presencia telefónica no prueba disponibilidad para WhatsApp. Los miembros habilitados son configuración, no presencia en línea."
      >
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Ejecutivo</Th>
              <Th>Canal</Th>
              <Th>Contexto</Th>
              <Th>Estado / habilitación</Th>
              <Th align="right">Carga informada</Th>
            </Thead>
            <Tbody>
              {catalogUnavailable || invalidSelection ? (
                <TableEmpty colSpan={5}>
                  Equipo no disponible para esta selección.
                </TableEmpty>
              ) : (
                <>
                  {showVoice &&
                    (agentsUnavailable ? (
                      <TableEmpty colSpan={5}>
                        No se pudo consultar la presencia de voz.
                      </TableEmpty>
                    ) : liveAgents.length === 0 ? (
                      <TableEmpty colSpan={5}>
                        Sin agentes de voz en esta selección.
                      </TableEmpty>
                    ) : (
                      liveAgents.map((agent) => (
                        <Tr key={`voice-${agent.profile_id}`}>
                          <Td strong>{agent.full_name}</Td>
                          <Td>Voz</Td>
                          <Td>{agent.campaign_name ?? "Sin campaña activa"}</Td>
                          <Td>{phoneState(agent)}</Td>
                          <Td align="right">
                            {agent.phone_status === "on_call"
                              ? "En llamada"
                              : "—"}
                          </Td>
                        </Tr>
                      ))
                    ))}
                  {showWhatsApp &&
                    (membersUnavailable ? (
                      <TableEmpty colSpan={5}>
                        No se pudo consultar la membresía de WhatsApp.
                      </TableEmpty>
                    ) : waAgents.size === 0 ? (
                      <TableEmpty colSpan={5}>
                        Sin miembros de WhatsApp en estas colas.
                      </TableEmpty>
                    ) : (
                      [...waAgents]
                        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                        .map(([id, agent]) => (
                          <Tr key={`wa-${id}`}>
                            <Td strong>{agent.name}</Td>
                            <Td>WhatsApp</Td>
                            <Td className="max-w-96">
                              {agent.queues.join(" · ")}
                            </Td>
                            <Td>
                              {agent.enabled
                                ? "Cuenta habilitada"
                                : "Cuenta deshabilitada"}
                            </Td>
                            <Td align="right">
                              {stockUnavailable
                                ? "—"
                                : `${stockByAgent.get(id) ?? 0} sin cerrar`}
                            </Td>
                          </Tr>
                        ))
                    ))}
                  {filters.channel === "email" && (
                    <TableEmpty colSpan={5}>
                      La carga y asignación por ejecutivo se administra en{" "}
                      <Link
                        href={
                          mailReports[0]?.campaign_id
                            ? `/dashboard/mail?campaign=${mailReports[0].campaign_id}`
                            : "/dashboard/mail"
                        }
                        className="font-medium text-primary hover:underline"
                      >
                        Correo
                      </Link>
                      .
                    </TableEmpty>
                  )}
                </>
              )}
            </Tbody>
          </Table>
        </div>
      </SectionCard>
        </div>
      </SectionCard>

      <details className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Definiciones y alcance de esta vista
        </summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            Sin cerrar: estados abiertos + pendientes. Sin asignar: registros de
            ese stock que no tienen responsable. Sin respuesta posterior: el
            último mensaje entrante es posterior al último saliente, o no hay
            saliente. No se utiliza el contador de mensajes no leídos para
            inferir espera.
          </p>
          <p>
            Antigüedad: tiempo transcurrido desde el último inbound sin
            respuesta posterior. No es el tiempo desde el primer mensaje sin
            responder ni un SLA certificado; no descuenta horario no hábil y una
            respuesta automática cuenta como saliente.
          </p>
          <p>
            La capacidad activa de WhatsApp, el estacionamiento y el
            cumplimiento de SLA no están expuestos por el modelo actual. Los
            límites configurados y los registros sin cerrar no sustituyen esas
            métricas. La configuración por miembro puede sobrescribir el límite
            de cola.
          </p>
          <p>
            La unidad operativa se identifica por su cola omnicanal. Voz en
            curso incluye intentos en cola, originando, sonando y conectados;
            WhatsApp conserva su stock y correo sus resultados. Las diferencias
            se presentan dentro de la unidad y no se suman como si compartieran
            la misma semántica.
          </p>
          <p>
            Consultar esta vista no asigna interacciones, no ocupa cupos, no
            marca mensajes como leídos y no permite responder. Los filtros
            permanecen en la URL y la actualización automática es opcional.
          </p>
        </div>
      </details>
    </div>
  );
}
