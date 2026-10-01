import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
import { notFound } from "next/navigation";

import { Badge, NavTabs, buttonClasses, type BadgeTone } from "@/components/ui";
import { CabeceraDeEntidad, Migas } from "../../_diseno";
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

/** Tono del canal: voz en azul, WhatsApp en verde; el resto sin punto. */
const CHANNEL_TONES: Record<string, BadgeTone> = {
  voice: "info",
  whatsapp: "success",
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
      <Migas items={[{ label: "Colas y enrutamiento", href: "/dashboard/admin/colas" }, { label: queue.name }]} />
      <CabeceraDeEntidad
        nombre={queue.name}
        icon={Layers}
        apagada={!queue.is_active}
        descripcion={queue.description ?? "Cola ACD omnicanal"}
        meta={
          <>
            <Badge tone={queue.is_active ? "success" : "neutral"}>{queue.is_active ? "Cola activa" : "Cola inactiva"}</Badge>
            {(sources ?? []).map((source, index) => {
              const campaign = one(source.campaigns as Relation<{ name: string }>);
              return (
                <Badge key={`${source.channel_type}-${index}`} tone={CHANNEL_TONES[source.channel_type] ?? "neutral"}>
                  {CHANNEL_LABELS[source.channel_type] ?? source.channel_type} · {campaign?.name ?? "Sin campaña"}
                </Badge>
              );
            })}
          </>
        }
        acciones={
          <Link href={`/dashboard/operacion?queue=${id}&channel=all`} className={buttonClasses({ variant: "secondary" })}>
            Ver operación de la cola <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        }
      />
      <NavTabs tabs={[
        { label: "Resumen de configuración", href: base },
        { label: "Enrutamiento", href: `${base}/enrutamiento` },
        { label: "Miembros", href: `${base}/miembros` },
        { label: "Fuentes", href: `${base}/fuentes` },
      ]} />
      {children}
    </div>
  );
}
