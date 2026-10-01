import Link from "next/link";
import { Radio, Users } from "lucide-react";
import { notFound } from "next/navigation";

import {
  Avatar,
  Badge,
  Callout,
  EmptyState,
  SectionCard,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  buttonClasses,
  type BadgeTone,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FranjaDeEstado } from "../../_diseno";

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

/** Tono del canal: voz en azul, WhatsApp en verde; el resto sin punto. */
const CHANNEL_TONES: Record<string, BadgeTone> = {
  voice: "info",
  whatsapp: "success",
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
      <p className="text-[13px] text-muted-foreground">
        Este espacio configura la cola. La carga, los equipos y las excepciones se consultan en{" "}
        <Link href={`/dashboard/operacion?queue=${id}&channel=all`} className="font-medium text-primary hover:underline">
          Operación
        </Link>
        , sin abrir conversaciones ni asumir atención.
      </p>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Reglas configuradas</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Valores administrativos; no son mediciones de ocupación, disponibilidad ni cumplimiento de SLA.
            </p>
          </div>
          <Link href={`${base}/enrutamiento`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Editar enrutamiento
          </Link>
        </div>
        <FranjaDeEstado
          celdas={[
            {
              label: "Estado de cola",
              value: queue.is_active ? "Activa" : "Inactiva",
              tone: queue.is_active ? "success" : "warning",
            },
            {
              label: "Estrategia de asignación",
              value: queue.routing_mode === "manual" ? "Manual" : "Menor carga",
            },
            {
              label: "Límite configurado por agente",
              value: queue.max_concurrent_per_agent ?? "Sin límite de cola",
              detail: "Un límite individual puede sobrescribirlo.",
            },
            {
              label: "Objetivo de respuesta configurado",
              value: `${Math.round(queue.service_level_seconds / 60)} min`,
              detail: "No representa un SLA medido.",
            },
          ]}
        />
      </section>

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
                  <EmptyState
                    icon={Radio}
                    title="No se pudo obtener la lista completa de fuentes."
                    description="No se interpreta como ausencia de canales."
                    className="py-6"
                  />
                </TableEmpty>
              ) : sources.length === 0 ? (
                <TableEmpty colSpan={5}>
                  <EmptyState icon={Radio} title="Esta cola no tiene fuentes configuradas." className="py-6" />
                </TableEmpty>
              ) : (
                sources.map((source) => {
                  const route = one(source.whatsapp_campaign_routes);
                  const channel = route ? one(route.whatsapp_channels) : null;
                  return (
                    <Tr key={source.id}>
                      <Td>
                        <Badge tone={CHANNEL_TONES[source.channel_type] ?? "neutral"}>
                          {CHANNEL_LABELS[source.channel_type] ??
                            source.channel_type}
                        </Badge>
                      </Td>
                      <Td>
                        {source.campaign_id ? (
                          <Link
                            href={`/dashboard/admin/campanas/${source.campaign_id}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {one(source.campaigns)?.name ?? "Abrir campaña"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Sin campaña</span>
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
                      <Td>
                        <Badge tone={source.is_active ? "success" : "neutral"}>
                          {source.is_active ? "Habilitada" : "Inactiva"}
                        </Badge>
                      </Td>
                      <Td>
                        {channel ? (
                          <Badge tone={channel.status === "active" ? "success" : "warning"}>
                            {channel.status === "active"
                              ? "Activo"
                              : "Requiere revisión"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No aplica</span>
                        )}
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
        title="Membresía ACD de WhatsApp"
        description="Este roster gobierna el enrutamiento automático de WhatsApp. Voz y correo usan los ejecutivos habilitados en su campaña."
        actions={
          <Link
            href={`${base}/miembros`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Editar miembros WhatsApp
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
                  <EmptyState
                    icon={Users}
                    title="No fue posible consultar la membresía completa."
                    description="Revisa la configuración antes de editarla."
                    className="py-6"
                  />
                </TableEmpty>
              ) : members.length === 0 ? (
                <TableEmpty colSpan={4}>
                  <EmptyState icon={Users} title="No hay miembros configurados en esta cola." className="py-6" />
                </TableEmpty>
              ) : (
                members.map((member) => {
                  const profile = one(member.profiles);
                  return (
                    <Tr key={member.profile_id}>
                      <Td>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={profile?.full_name} size="sm" />
                          <span className="font-medium text-foreground">
                            {profile?.full_name ?? "Usuario no disponible"}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={member.is_active ? "success" : "neutral"}>
                          {member.is_active ? "Habilitada" : "Inactiva"}
                        </Badge>
                      </Td>
                      <Td>
                        {profile ? (
                          <Badge tone={profile.active ? "success" : "neutral"}>
                            {profile.active ? "Habilitada" : "Deshabilitada"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No disponible</span>
                        )}
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
