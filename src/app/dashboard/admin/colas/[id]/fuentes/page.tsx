import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge, SectionCard, Table, TableEmpty, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
const CHANNEL_LABELS: Record<string, string> = { voice: "Voz", whatsapp: "WhatsApp Business", email: "Correo", chat: "Chat", instagram: "Instagram" };

export default async function QueueSourcesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: sources } = await supabase.from("contact_center_queue_sources").select("id, channel_type, campaign_id, is_active, campaigns(name), whatsapp_campaign_routes(whatsapp_channels(display_phone_number, business_name, status))").eq("queue_id", id).order("created_at");

  return (
    <SectionCard title="Fuentes conectadas" description="Las fuentes identifican el origen comercial y el canal; la cola define cómo se atienden.">
      <div className="overflow-x-auto"><Table><Thead><Th>Canal</Th><Th>Origen comercial</Th><Th>Cuenta / línea</Th><Th>Estado</Th><Th /></Thead><Tbody>
        {(sources ?? []).length === 0 && <TableEmpty colSpan={5}>Esta cola todavía no tiene fuentes conectadas.</TableEmpty>}
        {(sources ?? []).map((source) => { const campaign = one(source.campaigns as Relation<{ name: string }>); const route = one(source.whatsapp_campaign_routes as Relation<{ whatsapp_channels: Relation<{ display_phone_number: string; business_name: string; status: string }> }>); const channel = route ? one(route.whatsapp_channels) : null; const healthy = source.is_active && (source.channel_type !== "whatsapp" || channel?.status === "active"); const status = source.channel_type === "whatsapp" ? (healthy ? "Operativa" : "Pendiente") : (source.is_active ? "Habilitada" : "Inactiva"); return <Tr key={source.id}>
          <Td strong>{CHANNEL_LABELS[source.channel_type] ?? source.channel_type}</Td>
          <Td>{campaign?.name ?? "—"}</Td>
          <Td muted>{channel ? `${channel.business_name} · ${channel.display_phone_number}` : "—"}</Td>
          <Td><Badge tone={healthy ? "success" : "warning"}>{status}</Badge></Td>
          <Td align="right"><div className="flex justify-end gap-2">{source.campaign_id && <Link href={`/dashboard/admin/campanas/${source.campaign_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Campaña <ArrowUpRight size={12} /></Link>}{source.channel_type === "whatsapp" && <Link href="/dashboard/admin/integraciones/whatsapp" className={buttonClasses({ variant: "secondary", size: "sm" })}>Canal <ArrowUpRight size={12} /></Link>}</div></Td>
        </Tr>; })}
      </Tbody></Table></div>
    </SectionCard>
  );
}
