import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { Badge, NavTabs, PageHeader } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;

const CHANNEL_LABELS: Record<string, string> = {
  voice: "Voz",
  whatsapp: "WhatsApp",
  email: "Correo",
  chat: "Chat",
  instagram: "Instagram",
};

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function ContactCenterQueueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: queue }, { data: sources }] = await Promise.all([
    supabase.from("contact_center_queues").select("id, name, description, is_active").eq("id", id).maybeSingle(),
    supabase.from("contact_center_queue_sources").select("channel_type, campaigns(name)").eq("queue_id", id).eq("is_active", true),
  ]);
  if (!queue) notFound();
  const base = `/dashboard/admin/colas/${id}`;

  return (
    <div className="space-y-5">
      <Link href="/dashboard/admin/colas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"><ArrowLeft size={13} /> Colas y enrutamiento</Link>
      <PageHeader
        title={queue.name}
        description={queue.description ?? "Cola ACD omnicanal"}
        className="border-b-0 pb-0"
        actions={<div className="flex flex-wrap gap-2"><Badge tone={queue.is_active ? "success" : "danger"}>{queue.is_active ? "Cola activa" : "Cola inactiva"}</Badge>{(sources ?? []).map((source, index) => { const campaign = one(source.campaigns as Relation<{ name: string }>); return <Badge key={`${source.channel_type}-${index}`} tone="info">{CHANNEL_LABELS[source.channel_type] ?? source.channel_type} · {campaign?.name ?? "Sin campaña"}</Badge>; })}</div>}
      />
      <NavTabs tabs={[
        { label: "Resumen de configuración", href: base },
        { label: "Enrutamiento", href: `${base}/enrutamiento` },
        { label: "Miembros WhatsApp", href: `${base}/miembros` },
        { label: "Fuentes", href: `${base}/fuentes` },
      ]} />
      {children}
    </div>
  );
}
