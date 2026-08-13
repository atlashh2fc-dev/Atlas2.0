import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, ChevronRight, Mail, Phone, Users } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { campaignCapabilityKey } from "@/lib/campaign-capabilities";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";

type Capability = {
  title: string;
  description: string;
  href: string;
  icon: typeof Users;
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

  const [campaignResult, leadResult, mailResult, mailboxResult, dialerResult] = await Promise.all([
    supabase.from("campaigns").select("id,name,description,is_active").eq("id", id).single(),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("mail_campaigns").select("id,name,status,campaign_id,umbrella_key").eq("status", "active"),
    supabase.from("inbound_mailboxes").select("id,address,label").eq("campaign_id", id).eq("active", true),
    supabase.from("dialer_campaign_configs").select("campaign_id,dial_mode,is_active").eq("campaign_id", id).maybeSingle(),
  ]);

  const campaign = campaignResult.data;
  if (!campaign) notFound();

  const capabilities: Capability[] = [
    {
      title: "Registros",
      description: "Revisa y gestiona la base asociada a esta campaña.",
      href: `/dashboard/leads?campaign=${id}`,
      icon: Users,
      badge: `${(leadResult.count ?? 0).toLocaleString("es-CL")} registros`,
    },
  ];

  if (dialerResult.data) {
    capabilities.push({
      title: "Telefonía",
      description: "Opera llamadas y revisa los contactos de esta campaña.",
      href: `/dashboard/leads?campaign=${id}`,
      icon: Phone,
      badge: dialerResult.data.is_active ? "En operación" : "Disponible",
    });
  }

  const campaignKey = campaignCapabilityKey(campaign.name);
  const relatedMailCampaigns = (mailResult.data ?? []).filter(
    (mailCampaign) => mailCampaign.campaign_id === id || mailCampaign.umbrella_key === campaignKey
  );

  if (relatedMailCampaigns.length > 0) {
    const isUmbrella = relatedMailCampaigns.some((mailCampaign) => mailCampaign.umbrella_key === campaignKey);
    capabilities.push({
      title: "Señales de correo",
      description: "Prioriza aperturas y clicks generados por las campañas de correo.",
      href: isUmbrella
        ? `/dashboard/mail?campaignContext=${id}&umbrella=${encodeURIComponent(campaignKey)}`
        : `/dashboard/mail?campaign=${id}`,
      icon: Mail,
      badge: `${relatedMailCampaigns.length} campaña(s) mail`,
    });
  }

  if ((mailboxResult.data ?? []).length > 0) {
    capabilities.push({
      title: "Bandeja de entrada",
      description: "Convierte correos recibidos en registros para contacto telefónico.",
      href: `/dashboard/campanas/${id}/correo`,
      icon: Mail,
      badge: mailboxResult.data?.[0]?.address,
    });
  }

  capabilities.push({
    title: "Reportes",
    description: "Consulta resultados de gestión para esta campaña.",
    href: `/dashboard/reportes?campaign=${id}`,
    icon: BarChart3,
  });

  return (
    <div className="space-y-5">
      <Link href="/dashboard/campanas" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft size={13} /> Campañas
      </Link>
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? "Operación y canales disponibles para esta campaña."}
        actions={<Badge tone={campaign.is_active ? "success" : "danger"}>{campaign.is_active ? "Activa" : "Inactiva"}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {capabilities.map(({ title, description, href, icon: Icon, badge }) => (
          <Link key={title} href={href} className="group">
            <Card className="flex h-full items-start gap-4 transition-colors group-hover:border-primary">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-foreground group-hover:text-primary">{title}</h2>
                  <ChevronRight className="ml-auto shrink-0 text-muted-foreground group-hover:text-primary" size={16} />
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
                {badge && <Badge className="mt-3 max-w-full truncate" tone="neutral">{badge}</Badge>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
