import Link from "next/link";
import { ArrowUpRight, Mail, MessageCircle, Phone, Radio, type LucideIcon } from "lucide-react";

import { conectarCorreoDeCampana, desconectarFuenteDeCola } from "@/app/actions/contact-center-queues";
import { ActionForm, ActionSubmit, Avatar, Badge, EmptyState, Field, SectionCard, Select, Table, TableEmpty, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Grupo, PieDeFormulario } from "../../../_diseno";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const CHANNEL_LABELS: Record<string, string> = { voice: "Voz", whatsapp: "WhatsApp Business", email: "Correo", chat: "Chat", instagram: "Instagram" };
const CHANNEL_ICONS: Record<string, LucideIcon> = { voice: Phone, whatsapp: MessageCircle, email: Mail };

export default async function QueueSourcesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: sources }, { data: campaigns }, { data: conCorreo }] = await Promise.all([
    supabase.from("contact_center_queue_sources").select("id, channel_type, campaign_id, is_active, campaigns(name), whatsapp_campaign_routes(whatsapp_channels(display_phone_number, business_name, status))").eq("queue_id", id).order("created_at"),
    supabase.from("campaigns").select("id, name").order("name"),
    supabase.from("contact_center_queue_sources").select("campaign_id").eq("channel_type", "email").eq("is_active", true),
  ]);
  // Campañas cuyo correo todavía no atiende ninguna cola.
  const ocupadas = new Set((conCorreo ?? []).map((fila) => fila.campaign_id));
  const libres = (campaigns ?? []).filter((campaign) => !ocupadas.has(campaign.id));

  return (
    <SectionCard title="Fuentes conectadas" description="Las fuentes identifican el origen comercial y el canal; la cola define cómo se atienden.">
      <div className="overflow-x-auto"><Table><Thead><Th>Origen comercial</Th><Th>Canal</Th><Th>Estado</Th><Th><span className="sr-only">Acciones</span></Th></Thead><Tbody>
        {(sources ?? []).length === 0 && <TableEmpty colSpan={4}><EmptyState icon={Radio} title="Esta cola todavía no tiene fuentes conectadas." description={libres.length > 0 ? "Conecta abajo el correo de una campaña." : undefined} className="py-6" /></TableEmpty>}
        {(sources ?? []).map((source) => {
          const campaign = one(source.campaigns as Relation<{ name: string }>);
          const route = one(source.whatsapp_campaign_routes as Relation<{ whatsapp_channels: Relation<{ display_phone_number: string; business_name: string; status: string }> }>);
          const channel = route ? one(route.whatsapp_channels) : null;
          const healthy = source.is_active && (source.channel_type !== "whatsapp" || channel?.status === "active");
          const status = source.channel_type === "whatsapp" ? (healthy ? "Operativa" : "Pendiente") : (source.is_active ? "Habilitada" : "Inactiva");
          const Icono = CHANNEL_ICONS[source.channel_type] ?? Radio;
          return <Tr key={source.id}>
            <Td>
              <span className="flex items-center gap-3">
                <Avatar name={campaign?.name ?? CHANNEL_LABELS[source.channel_type] ?? source.channel_type} size="md" shape="square" />
                <span className="min-w-0">
                  {source.campaign_id ? (
                    <Link href={`/dashboard/admin/campanas/${source.campaign_id}`} className="block truncate font-medium text-foreground hover:text-primary">{campaign?.name ?? "Campaña"}</Link>
                  ) : (
                    <span className="block font-medium text-muted-foreground">Sin campaña</span>
                  )}
                  {channel && <span className="block truncate text-xs text-muted-foreground">{channel.business_name} · {channel.display_phone_number}</span>}
                </span>
              </span>
            </Td>
            <Td>
              <span className="inline-flex items-center gap-2 text-foreground">
                <Icono size={14} className="text-muted-foreground" aria-hidden="true" />
                {CHANNEL_LABELS[source.channel_type] ?? source.channel_type}
              </span>
            </Td>
            <Td><Badge tone={healthy ? "success" : "warning"}>{status}</Badge></Td>
            <Td align="right"><div className="flex items-center justify-end gap-1">
              {source.channel_type === "whatsapp" && <Link href="/dashboard/admin/integraciones/whatsapp" className={buttonClasses({ variant: "ghost", size: "sm" })}>Ver canal <ArrowUpRight size={12} /></Link>}
              {source.channel_type === "email" && source.is_active && <ActionForm action={desconectarFuenteDeCola} success="Correo desconectado de la cola"><input type="hidden" name="queue_id" value={id} /><input type="hidden" name="source_id" value={source.id} /><ActionSubmit variant="ghost" size="sm" pendingLabel="…">Desconectar</ActionSubmit></ActionForm>}
            </div></Td>
          </Tr>;
        })}
      </Tbody></Table></div>
      {libres.length === 0 ? (
        <p className="border-t border-border bg-surface-raised px-5 py-3 text-xs text-muted-foreground">El correo de todas las campañas ya lo atiende alguna cola.</p>
      ) : (
      <ActionForm action={conectarCorreoDeCampana} success="Correo conectado: sus respuestas se reparten en esta cola" className="divide-y divide-border border-t border-border">
        <input type="hidden" name="queue_id" value={id} />
        <Grupo titulo="Conectar correo" descripcion="Las respuestas de correo de la campaña elegida se reparten entre los miembros de esta cola." columnas={1}>
          <Field label="Atender en esta cola el correo de" className="max-w-sm">
            <Select name="campaign_id" required defaultValue="">
              <option value="" disabled>Elige una campaña</option>
              {libres.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </Select>
          </Field>
        </Grupo>
        <PieDeFormulario>
          <ActionSubmit variant="secondary" pendingLabel="Conectando…">Conectar correo</ActionSubmit>
        </PieDeFormulario>
      </ActionForm>
      )}
    </SectionCard>
  );
}
