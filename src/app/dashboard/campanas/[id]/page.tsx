import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Bot, ChevronRight, Inbox, Mail, Megaphone, Phone, Users } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { campaignCapabilityKey } from "@/lib/campaign-capabilities";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader, SectionCard, type SectionTone } from "@/components/ui";

type Capability = {
  title: string;
  description: string;
  href: string;
  icon: typeof Users;
  /** Color del chip según el dominio (mismo criterio que el menú). */
  tone: SectionTone;
  badge?: string;
};

export default async function OperationalCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  if (profile.role === "supervisor") {
    const { data: scope } = await supabase.rpc("get_report_scope_campaigns");
    if (!(scope ?? []).some((campaign: { id: string }) => campaign.id === id)) notFound();
  }

  const [campaignResult, leadResult, mailResult, mailboxResult, dialerResult, aiVoiceResult] = await Promise.all([
    supabase.from("campaigns").select("id,name,description,is_active").eq("id", id).single(),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("mail_campaigns").select("id,name,status,campaign_id,umbrella_key").eq("status", "active"),
    supabase.from("inbound_mailboxes").select("id,address,label").eq("campaign_id", id).eq("active", true),
    supabase.from("dialer_campaign_configs").select("campaign_id,dial_mode,is_active").eq("campaign_id", id).maybeSingle(),
    supabase
      .from("ai_voice_campaign_configs")
      .select("campaign_id,provider,is_active,phone_number_id")
      .eq("campaign_id", id)
      .maybeSingle(),
  ]);

  const campaign = campaignResult.data;
  if (!campaign) notFound();

  const capabilities: Capability[] = [
    {
      title: "Registros",
      description: "Revisa y gestiona la base asociada a esta campaña.",
      href: `/dashboard/leads?campaign=${id}`,
      icon: Users,
      tone: "blue",
      badge: `${(leadResult.count ?? 0).toLocaleString("es-CL")} registros`,
    },
  ];

  if (dialerResult.data) {
    capabilities.push({
      title: "Telefonía",
      description: "Opera llamadas y revisa los contactos de esta campaña.",
      href: `/dashboard/leads?campaign=${id}`,
      icon: Phone,
      tone: "primary",
      badge: dialerResult.data.is_active ? "En operación" : "Disponible",
    });
  }

  if (aiVoiceResult.data && profile.role === "admin") {
    capabilities.push({
      title: "Voz IA",
      description: "Configura y supervisa las llamadas automáticas de ElevenLabs.",
      href: `/dashboard/admin/campanas/${id}/ia`,
      icon: Bot,
      tone: "violet",
      badge: aiVoiceResult.data.is_active
        ? "En ejecución"
        : aiVoiceResult.data.phone_number_id
          ? "Detenida"
          : "Pendiente de troncal",
    });
  }

  const campaignKey = campaignCapabilityKey(campaign.name);
  const relatedMailCampaigns = (mailResult.data ?? []).filter(
    (mailCampaign) => mailCampaign.campaign_id === id || mailCampaign.umbrella_key === campaignKey
  );

  if (relatedMailCampaigns.length > 0) {
    const isUmbrella = relatedMailCampaigns.some((mailCampaign) => mailCampaign.umbrella_key === campaignKey);
    capabilities.push({
      title: "Correo",
      description: "Prioriza aperturas y clicks generados por las campañas de correo.",
      href: isUmbrella
        ? `/dashboard/mail?campaignContext=${id}&umbrella=${encodeURIComponent(campaignKey)}`
        : `/dashboard/mail?campaign=${id}`,
      icon: Mail,
      tone: "teal",
      badge: `${relatedMailCampaigns.length} campaña(s) mail`,
    });
  }

  if ((mailboxResult.data ?? []).length > 0) {
    capabilities.push({
      title: "Bandeja de entrada",
      description: "Convierte correos recibidos en registros para contacto telefónico.",
      href: `/dashboard/campanas/${id}/correo`,
      icon: Inbox,
      tone: "teal",
      badge: mailboxResult.data?.[0]?.address,
    });
  }

  capabilities.push({
    title: "Reportes",
    description: "Consulta resultados de gestión para esta campaña.",
    href: `/dashboard/reportes?campaign=${id}`,
    icon: BarChart3,
    tone: "violet",
  });

  return (
    <div className="space-y-5">
      <Link href="/dashboard/campanas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft size={13} /> Campañas
      </Link>
      <PageHeader
        title={campaign.name}
        icon={Megaphone}
        description={campaign.description ?? "Operación y canales disponibles para esta campaña."}
        meta={
          <>
            <Badge tone={campaign.is_active ? "success" : "danger"}>{campaign.is_active ? "Activa" : "Inactiva"}</Badge>
            <span>
              <span className="font-medium text-foreground">{(leadResult.count ?? 0).toLocaleString("es-CL")}</span> registros
            </span>
          </>
        }
      />

      <SectionCard title="Qué puedes hacer en esta campaña" description="Cada canal habilitado abre su propia vista, ya filtrada por la campaña.">
        <ul className="divide-y divide-border/70 border-t border-border">
          {capabilities.map(({ title, description, href, icon: Icon, tone, badge }) => (
            <li key={title}>
              <Link
                href={href}
                className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-muted/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="icon-chip size-9 rounded-lg" data-tone={tone} aria-hidden="true">
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
                {badge && (
                  <span className="hidden max-w-56 truncate text-right text-xs text-muted-foreground sm:block" title={badge}>
                    {badge}
                  </span>
                )}
                <ChevronRight
                  className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary"
                  size={16}
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
