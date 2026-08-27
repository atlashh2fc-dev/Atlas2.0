import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";

import {
  Badge,
  Callout,
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

type Relation<T> = T | T[] | null;
type Source = {
  id: string;
  channel_type: string;
  is_active: boolean;
  campaign_id: string | null;
  campaigns: Relation<{ name: string }>;
  whatsapp_campaign_routes: Relation<{
    whatsapp_channels: Relation<{
      display_phone_number: string | null;
      business_name: string | null;
      status: string;
    }>;
  }>;
};
type Member = {
  profile_id: string;
  is_active: boolean;
  max_concurrent: number | null;
  profiles: Relation<{ full_name: string; active: boolean }>;
};
const one = <T,>(value: Relation<T>): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;
const CHANNEL_LABELS: Record<string, string> = {
  voice: "Voz",
  whatsapp: "WhatsApp",
  email: "Correo",
  chat: "Chat",
  instagram: "Instagram",
};

export default async function ContactCenterQueuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [queueResult, sourcesResult, membersResult] = await Promise.all([
    supabase
      .from("contact_center_queues")
      .select(
        "id, name, is_active, routing_mode, service_level_seconds, max_concurrent_per_agent",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contact_center_queue_sources")
      .select(
        "id, channel_type, is_active, campaign_id, campaigns(name), whatsapp_campaign_routes(whatsapp_channels(display_phone_number, business_name, status))",
        { count: "exact" },
      )
      .eq("queue_id", id)
      .order("created_at")
      .limit(1000),
    supabase
      .from("contact_center_queue_members")
      .select(
        "profile_id, is_active, max_concurrent, profiles(full_name, active)",
        { count: "exact" },
      )
      .eq("queue_id", id)
      .order("joined_at")
      .limit(1000),
  ]);
  if (queueResult.error)
    return (
      <Callout tone="warning">
        No fue posible consultar la configuración de esta cola. Actualiza o
        revisa los permisos.
      </Callout>
    );
  if (!queueResult.data) notFound();

  const queue = queueResult.data;
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
  const sources = (sourcesResult.data ?? []) as Source[];
  const members = (membersResult.data ?? []) as Member[];
  const base = `/dashboard/admin/colas/${id}`;

  return (
    <div className="space-y-5">
      <Callout tone="info">
        Este espacio configura la cola. La carga, los equipos y las excepciones
        se consultan en Operación, sin abrir conversaciones ni asumir atención.
        <Link
          href={`/dashboard/operacion?queue=${id}&channel=whatsapp`}
          className={buttonClasses({
            variant: "secondary",
            size: "sm",
            className: "mt-3",
          })}
        >
          Ver operación de cola <ArrowUpRight size={13} />
        </Link>
      </Callout>

      <SectionCard
        title="Reglas configuradas"
        description="Valores administrativos; no son mediciones de ocupación, disponibilidad ni cumplimiento de SLA."
        actions={
          <Link
            href={`${base}/enrutamiento`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Editar enrutamiento
          </Link>
        }
      >
        <dl className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Estado de cola</dt>
            <dd className="mt-2">
              <Badge tone={queue.is_active ? "neutral" : "warning"}>
                {queue.is_active ? "Activa" : "Inactiva"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Estrategia de asignación
            </dt>
            <dd className="mt-2 text-sm font-medium">
              {queue.routing_mode === "manual" ? "Manual" : "Menor carga"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Límite configurado por agente
            </dt>
            <dd className="mt-2 text-sm font-medium">
              {queue.max_concurrent_per_agent ?? "Sin límite de cola"}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              Un límite individual puede sobrescribirlo.
            </p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Objetivo de respuesta configurado
            </dt>
            <dd className="mt-2 text-sm font-medium">
              {Math.round(queue.service_level_seconds / 60)} min
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              No representa un SLA medido.
            </p>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Fuentes y canales"
        description="Relación entre campañas, canales y esta cola; incluye fuentes inactivas para revisar su configuración."
        actions={
          <Link
            href={`${base}/fuentes`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Ver fuentes
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Canal</Th>
              <Th>Campaña</Th>
              <Th>Cuenta / línea</Th>
              <Th>Estado de fuente</Th>
              <Th>Estado de canal</Th>
            </Thead>
            <Tbody>
              {sourcesUnavailable ? (
                <TableEmpty colSpan={5}>
                  No se pudo obtener la lista completa de fuentes. No se
                  interpreta como ausencia de canales.
                </TableEmpty>
              ) : sources.length === 0 ? (
                <TableEmpty colSpan={5}>
                  Esta cola no tiene fuentes configuradas.
                </TableEmpty>
              ) : (
                sources.map((source) => {
                  const route = one(source.whatsapp_campaign_routes);
                  const channel = route ? one(route.whatsapp_channels) : null;
                  return (
                    <Tr key={source.id}>
                      <Td>
                        {CHANNEL_LABELS[source.channel_type] ??
                          source.channel_type}
                      </Td>
                      <Td>
                        {source.campaign_id ? (
                          <Link
                            href={`/dashboard/admin/campanas/${source.campaign_id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {one(source.campaigns)?.name ?? "Abrir campaña"}
                          </Link>
                        ) : (
                          "Sin campaña"
                        )}
                      </Td>
                      <Td>
                        {channel?.business_name ?? "—"}
                        {channel?.display_phone_number && (
                          <p className="text-xs text-muted-foreground">
                            {channel.display_phone_number}
                          </p>
                        )}
                      </Td>
                      <Td>{source.is_active ? "Habilitada" : "Inactiva"}</Td>
                      <Td>
                        {channel
                          ? channel.status === "active"
                            ? "Activo"
                            : "Requiere revisión"
                          : "No informado"}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>
        </div>
      </SectionCard>

      <SectionCard
        title="Membresía y límites individuales"
        description="La habilitación de una cuenta y su membresía no equivalen a estar disponible para atender."
        actions={
          <Link
            href={`${base}/miembros`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Editar miembros
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Th>Ejecutivo</Th>
              <Th>Membresía</Th>
              <Th>Cuenta</Th>
              <Th>Límite configurado</Th>
            </Thead>
            <Tbody>
              {membersUnavailable ? (
                <TableEmpty colSpan={4}>
                  No fue posible consultar la membresía completa. Revisa la
                  configuración antes de editarla.
                </TableEmpty>
              ) : members.length === 0 ? (
                <TableEmpty colSpan={4}>
                  No hay miembros configurados en esta cola.
                </TableEmpty>
              ) : (
                members.map((member) => {
                  const profile = one(member.profiles);
                  return (
                    <Tr key={member.profile_id}>
                      <Td strong>
                        {profile?.full_name ?? "Usuario no disponible"}
                      </Td>
                      <Td>{member.is_active ? "Habilitada" : "Inactiva"}</Td>
                      <Td>
                        {profile
                          ? profile.active
                            ? "Habilitada"
                            : "Deshabilitada"
                          : "No disponible"}
                      </Td>
                      <Td>
                        {member.max_concurrent !== null
                          ? `${member.max_concurrent} · individual`
                          : queue.max_concurrent_per_agent !== null
                            ? `${queue.max_concurrent_per_agent} · hereda cola`
                            : "Sin límite configurado"}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>
        </div>
      </SectionCard>
    </div>
  );
}
