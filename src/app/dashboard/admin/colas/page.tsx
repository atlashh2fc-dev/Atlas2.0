import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";

import {
  Avatar,
  Badge,
  Callout,
  EmptyState,
  InfoTooltip,
  PageHeader,
  SectionCard,
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
import { loadOperationalConversations } from "@/lib/operations-data";
import { FlechaDeFila } from "../_diseno";

type Relation<T> = T | T[] | null;

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const CHANNEL_LABELS: Record<string, string> = {
  voice: "Voz",
  whatsapp: "WhatsApp",
  email: "Correo",
  chat: "Chat",
  instagram: "Instagram",
};

export default async function ContactCenterQueuesPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const [queuesResult, sourcesResult, membersResult, conversationsResult] =
    await Promise.all([
      supabase
        .from("contact_center_queues")
        .select(
          "id, name, description, is_active, routing_mode, service_level_seconds, max_concurrent_per_agent",
          { count: "exact" },
        )
        .order("name")
        .limit(1000),
      supabase
        .from("contact_center_queue_sources")
        .select(
          "queue_id, channel_type, campaigns(name), whatsapp_campaign_routes(whatsapp_channels(display_phone_number))",
          { count: "exact" },
        )
        .eq("is_active", true)
        .limit(1000),
      supabase
        .from("contact_center_queue_members")
        .select("queue_id", { count: "exact" })
        .eq("is_active", true)
        .limit(1000),
      loadOperationalConversations(supabase, { campaign: "", queue: "" }),
    ]);
  const queuesUnavailable = Boolean(
    queuesResult.error ||
    queuesResult.count === null ||
    queuesResult.count > 1000,
  );
  const sourcesUnavailable = Boolean(
    sourcesResult.error ||
    sourcesResult.count === null ||
    sourcesResult.count > 1000,
  );
  const membersUnavailable = Boolean(
    membersResult.error ||
    membersResult.count === null ||
    membersResult.count > 1000,
  );
  const stockUnavailable = Boolean(
    conversationsResult.error || conversationsResult.data === null,
  );

  if (stockUnavailable) {
    console.error("[admin/colas] stock de WhatsApp", conversationsResult.error);
  }

  const memberCount = new Map<string, number>();
  for (const member of membersResult.data ?? []) {
    memberCount.set(
      member.queue_id,
      (memberCount.get(member.queue_id) ?? 0) + 1,
    );
  }
  const activeCount = new Map<string, number>();
  const unassignedCount = new Map<string, number>();
  for (const conversation of conversationsResult.data ?? []) {
    if (!conversation.queue_id) continue;
    activeCount.set(
      conversation.queue_id,
      (activeCount.get(conversation.queue_id) ?? 0) + 1,
    );
    if (!conversation.assigned_to) {
      unassignedCount.set(
        conversation.queue_id,
        (unassignedCount.get(conversation.queue_id) ?? 0) + 1,
      );
    }
  }
  const sourcesByQueue = new Map<string, typeof sourcesResult.data>();
  for (const source of sourcesResult.data ?? []) {
    sourcesByQueue.set(source.queue_id, [
      ...(sourcesByQueue.get(source.queue_id) ?? []),
      source,
    ]);
  }

  const queues = queuesResult.data ?? [];
  const activeQueues = queues.filter((queue) => queue.is_active).length;
  const totalUnassigned = [...unassignedCount.values()].reduce((sum, value) => sum + value, 0);

  /** «WhatsApp · Ventas Hogar, Correo · Equifax»: de dónde le llega trabajo a la cola. */
  const sourcesLine = (queueId: string): string => {
    const sources = sourcesByQueue.get(queueId) ?? [];
    return sources
      .map((source) => {
        const campaign = one(source.campaigns as Relation<{ name: string }>);
        const route = one(
          source.whatsapp_campaign_routes as Relation<{
            whatsapp_channels: Relation<{ display_phone_number: string }>;
          }>,
        );
        const channel = route ? one(route.whatsapp_channels) : null;
        return `${CHANNEL_LABELS[source.channel_type] ?? source.channel_type} · ${
          campaign?.name ?? channel?.display_phone_number ?? "Sin origen"
        }`;
      })
      .join(", ");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Colas y enrutamiento"
        icon={Layers}
        description="Configuración omnicanal: fuentes, estrategia y membresía ACD de WhatsApp. Voz y correo conservan sus ejecutivos por campaña."
        meta={
          !queuesUnavailable && queues.length > 0 ? (
            <>
              <span>
                <span className="font-semibold text-foreground">{queues.length}</span> {queues.length === 1 ? "cola" : "colas"}
              </span>
              <span>
                <span className="font-semibold text-foreground">{activeQueues}</span> {activeQueues === 1 ? "activa" : "activas"}
              </span>
              {!stockUnavailable && (
                <span className={totalUnassigned > 0 ? "text-warning" : undefined}>
                  <span className="font-semibold">{totalUnassigned}</span> WhatsApp sin asignar
                </span>
              )}
            </>
          ) : undefined
        }
        actions={
          <Link
            href="/dashboard/operacion"
            className={buttonClasses({ variant: "secondary" })}
          >
            Ver operación <ArrowUpRight size={14} />
          </Link>
        }
      />
      <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
        Esta vista muestra los recursos ACD configurados; no es el catálogo completo de campañas. Una cola puede estar todavía sin fuentes, y una campaña sólo aparece aquí cuando se conecta explícitamente a una cola. Las campañas se administran desde{" "}
        <Link href="/dashboard/admin/campanas" className="font-medium text-primary hover:underline">
          Campañas
        </Link>
        .
      </p>
      {(queuesUnavailable || sourcesUnavailable || membersUnavailable) && (
        <Callout tone="warning">
          No fue posible consultar completa la configuración. Los valores no
          disponibles no se presentan como cero.
        </Callout>
      )}
      {stockUnavailable && (
        <Callout tone="warning">
          No se pudo calcular el stock de WhatsApp de todas las colas a la vez,
          por eso esas columnas dicen «No disponible». Para ver las cifras, abre{" "}
          <Link href="/dashboard/operacion" className="font-medium text-primary hover:underline">
            Operación
          </Link>{" "}
          y elige una campaña o cola.
        </Callout>
      )}

      <SectionCard>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Cola</Th>
              <Th>Enrutamiento</Th>
              <Th align="right">Miembros WhatsApp</Th>
              <Th align="right">
                <span className="inline-flex items-center gap-1">
                  WhatsApp abiertos
                  <InfoTooltip text="Conversaciones de WhatsApp sin cerrar en la cola. Debajo, las que todavía no tienen ejecutivo." align="right" />
                </span>
              </Th>
              <Th>Estado</Th>
              <Th>
                <span className="sr-only">Abrir</span>
              </Th>
            </Thead>
            <Tbody>
              {queuesUnavailable ? (
                <TableEmpty colSpan={6}>
                  <EmptyState icon={Layers} title="Configuración de colas no disponible." className="py-6" />
                </TableEmpty>
              ) : (
                queues.length === 0 && (
                  <TableEmpty colSpan={6}>
                    {/* No hay acción para crear colas desde aquí: nacen al
                        conectar un canal digital a una campaña. */}
                    <EmptyState
                      icon={Layers}
                      title="Aún no hay colas configuradas."
                      description="Las colas nacen al conectar un canal digital (WhatsApp, Instagram, Messenger o correo) a una campaña. Conecta el canal en Integraciones y pide a soporte de Atlas que habilite la cola."
                      action={
                        <Link
                          href="/dashboard/admin/integraciones"
                          className={buttonClasses({ variant: "secondary", size: "sm" })}
                        >
                          Ir a Integraciones <ArrowUpRight size={13} />
                        </Link>
                      }
                      className="py-6"
                    />
                  </TableEmpty>
                )
              )}
              {!queuesUnavailable &&
                queues.map((queue) => {
                  const href = `/dashboard/admin/colas/${queue.id}`;
                  const sources = sourcesLine(queue.id);
                  const unassigned = unassignedCount.get(queue.id) ?? 0;
                  return (
                    <Tr key={queue.id}>
                      <Td className="min-w-72">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={queue.name}
                            icon={Layers}
                            size="md"
                            shape="square"
                            className={queue.is_active ? "" : "opacity-50"}
                          />
                          <div className="min-w-0">
                            <Link href={href} className="font-medium text-foreground hover:text-primary">
                              {queue.name}
                            </Link>
                            <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground" title={sources || undefined}>
                              {sourcesUnavailable
                                ? "Fuentes no disponibles"
                                : sources || "Sin fuentes habilitadas"}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="block text-foreground">
                          {queue.routing_mode === "least_loaded" ? "Menor carga" : "Manual"}
                        </span>
                        <span className="block text-xs text-muted-foreground" title="Objetivo configurado; no es un SLA medido">
                          Responder en {Math.round(queue.service_level_seconds / 60)} min
                        </span>
                      </Td>
                      <Td align="right">
                        {membersUnavailable ? (
                          <span className="text-xs text-muted-foreground">No disponible</span>
                        ) : (
                          <span className="font-medium text-foreground">{memberCount.get(queue.id) ?? 0}</span>
                        )}
                      </Td>
                      <Td align="right" className={stockUnavailable ? "whitespace-nowrap text-xs text-muted-foreground" : "whitespace-nowrap"}>
                        {stockUnavailable
                          ? "No disponible"
                          : (
                          <>
                            <span className="block font-medium text-foreground">{activeCount.get(queue.id) ?? 0}</span>
                            <span className={`block text-xs ${unassigned > 0 ? "font-medium text-warning" : "text-muted-foreground"}`}>
                              {unassigned} sin asignar
                            </span>
                          </>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={queue.is_active ? "success" : "neutral"}>
                          {queue.is_active ? "Activa" : "Inactiva"}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <FlechaDeFila href={href} label={`Configurar ${queue.name}`} />
                      </Td>
                    </Tr>
                  );
                })}
            </Tbody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}
