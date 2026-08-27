import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  Badge,
  Callout,
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

type Relation<T> = T | T[] | null;

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Colas y enrutamiento"
        description="Configuración ACD: fuentes, membresía, estrategia, límites y objetivos. El stock WhatsApp no representa capacidad ocupada."
        actions={
          <Link
            href="/dashboard/operacion"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Ver operación <ArrowUpRight size={13} />
          </Link>
        }
      />
      {(queuesUnavailable || sourcesUnavailable || membersUnavailable) && (
        <Callout tone="warning">
          No fue posible consultar completa la configuración. Los valores no
          disponibles no se presentan como cero.
        </Callout>
      )}
      {stockUnavailable && (
        <Callout tone="warning">
          {conversationsResult.error ??
            "El stock de WhatsApp no está disponible."}{" "}
          Consulta Operación con una campaña o cola seleccionada.
        </Callout>
      )}

      <SectionCard>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Cola</Th>
              <Th>Fuentes conectadas</Th>
              <Th>Enrutamiento</Th>
              <Th align="right">Miembros habilitados</Th>
              <Th align="right">WhatsApp sin cerrar</Th>
              <Th align="right">WhatsApp sin asignar</Th>
              <Th>Objetivo configurado</Th>
              <Th />
            </Thead>
            <Tbody>
              {queuesUnavailable ? (
                <TableEmpty colSpan={8}>
                  Configuración de colas no disponible.
                </TableEmpty>
              ) : (
                (queuesResult.data ?? []).length === 0 && (
                  <TableEmpty colSpan={8}>
                    Aún no hay colas configuradas.
                  </TableEmpty>
                )
              )}
              {!queuesUnavailable &&
                (queuesResult.data ?? []).map((queue) => {
                  const sources = sourcesByQueue.get(queue.id) ?? [];
                  return (
                    <Tr key={queue.id}>
                      <Td strong className="min-w-64">
                        <Link
                          href={`/dashboard/admin/colas/${queue.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {queue.name}
                        </Link>
                        {queue.description && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                            {queue.description}
                          </p>
                        )}
                      </Td>
                      <Td className="min-w-64">
                        <div className="flex flex-wrap gap-1">
                          {sourcesUnavailable ? (
                            <span className="text-xs text-muted-foreground">
                              No disponible
                            </span>
                          ) : sources.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              Sin fuentes habilitadas
                            </span>
                          ) : (
                            sources.map((source, index) => {
                              const campaign = one(
                                source.campaigns as Relation<{ name: string }>,
                              );
                              const route = one(
                                source.whatsapp_campaign_routes as Relation<{
                                  whatsapp_channels: Relation<{
                                    display_phone_number: string;
                                  }>;
                                }>,
                              );
                              const channel = route
                                ? one(route.whatsapp_channels)
                                : null;
                              return (
                                <Badge
                                  key={`${source.channel_type}-${index}`}
                                  tone="info"
                                >
                                  {source.channel_type === "whatsapp"
                                    ? "WhatsApp"
                                    : source.channel_type}{" "}
                                  ·{" "}
                                  {campaign?.name ??
                                    channel?.display_phone_number ??
                                    "Sin origen"}
                                </Badge>
                              );
                            })
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            queue.routing_mode === "least_loaded"
                              ? "success"
                              : "info"
                          }
                        >
                          {queue.routing_mode === "least_loaded"
                            ? "Menor carga"
                            : "Manual"}
                        </Badge>
                      </Td>
                      <Td align="right">
                        {membersUnavailable
                          ? "No disponible"
                          : (memberCount.get(queue.id) ?? 0)}
                      </Td>
                      <Td align="right">
                        {stockUnavailable
                          ? "No disponible"
                          : (activeCount.get(queue.id) ?? 0)}
                      </Td>
                      <Td align="right">
                        <span
                          className={
                            !stockUnavailable &&
                            (unassignedCount.get(queue.id) ?? 0) > 0
                              ? "font-semibold text-warning"
                              : ""
                          }
                        >
                          {stockUnavailable
                            ? "No disponible"
                            : (unassignedCount.get(queue.id) ?? 0)}
                        </span>
                      </Td>
                      <Td>
                        {Math.round(queue.service_level_seconds / 60)} min
                        <p className="text-xs text-muted-foreground">
                          No es un SLA medido
                        </p>
                      </Td>
                      <Td align="right">
                        <Link
                          href={`/dashboard/admin/colas/${queue.id}`}
                          className={buttonClasses({
                            variant: "secondary",
                            size: "sm",
                          })}
                        >
                          Configurar <ArrowUpRight size={13} />
                        </Link>
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
