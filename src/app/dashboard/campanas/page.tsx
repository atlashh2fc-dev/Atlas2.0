import Link from "next/link";
import { Bot, ChevronRight, Inbox, Mail, Megaphone, MessageCircle, Phone } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { campaignCapabilityKey } from "@/lib/campaign-capabilities";
import { createClient } from "@/lib/supabase/server";
import { Avatar, EmptyState, PageHeader, SectionCard, type SectionTone } from "@/components/ui";

type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
};

export default async function OperationalCampaignsPage() {
  const profile = await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();

  const { data: scopeRows, error: campaignsError } = profile.role === "supervisor"
    ? await supabase.rpc("get_report_scope_campaigns")
    : await supabase
        .from("campaigns")
        .select("id,name,description")
        .eq("is_active", true)
        .order("name");

  if (campaignsError) throw new Error(campaignsError.message);
  const campaigns = (scopeRows ?? []) as CampaignRow[];
  const ids = campaigns.map((campaign) => campaign.id);

  const [mailResult, mailboxResult, dialerResult, aiVoiceResult, queueSourceResult] = ids.length > 0
    ? await Promise.all([
        supabase.from("mail_campaigns").select("campaign_id,umbrella_key").eq("status", "active"),
        supabase.from("inbound_mailboxes").select("campaign_id").in("campaign_id", ids).eq("active", true),
        supabase.from("dialer_campaign_configs").select("campaign_id").in("campaign_id", ids),
        supabase.from("ai_voice_campaign_configs").select("campaign_id,is_active").in("campaign_id", ids),
        supabase.from("contact_center_queue_sources").select("campaign_id,channel_type").in("campaign_id", ids).eq("is_active", true),
      ])
    : [
        { data: [] as { campaign_id: string; umbrella_key: string }[] },
        { data: [] as { campaign_id: string }[] },
        { data: [] as { campaign_id: string }[] },
        { data: [] as { campaign_id: string; is_active: boolean }[] },
        { data: [] as { campaign_id: string; channel_type: string }[] },
      ];

  const withMailSignals = new Set((mailResult.data ?? []).map((row) => row.campaign_id));
  const mailUmbrellas = new Set((mailResult.data ?? []).map((row) => row.umbrella_key));
  for (const campaign of campaigns) {
    if (mailUmbrellas.has(campaignCapabilityKey(campaign.name))) withMailSignals.add(campaign.id);
  }
  const withMailbox = new Set((mailboxResult.data ?? []).map((row) => row.campaign_id));
  const withPhone = new Set((dialerResult.data ?? []).map((row) => row.campaign_id));
  const withAiVoice = new Set((aiVoiceResult.data ?? []).map((row) => row.campaign_id));
  const withWhatsApp = new Set(
    (queueSourceResult.data ?? [])
      .filter((row) => row.channel_type === "whatsapp")
      .map((row) => row.campaign_id),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campañas"
        icon={Megaphone}
        description="Selecciona una campaña para trabajar con sus registros y canales habilitados."
        meta={
          <span>
            <span className="font-medium text-foreground">{campaigns.length.toLocaleString("es-CL")}</span>{" "}
            {campaigns.length === 1 ? "campaña operativa" : "campañas operativas"}
          </span>
        }
      />

      <SectionCard>
        {campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No hay campañas operativas"
            description="Revisa la asignación o el estado de las campañas."
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {campaigns.map((campaign) => {
              const channels = [
                withPhone.has(campaign.id) ? { label: "Teléfono", icon: Phone, tone: "primary" } : null,
                withAiVoice.has(campaign.id) ? { label: "Voz IA · ElevenLabs", icon: Bot, tone: "violet" } : null,
                withMailSignals.has(campaign.id) ? { label: "Correo", icon: Mail, tone: "teal" } : null,
                withMailbox.has(campaign.id) ? { label: "Bandeja de entrada", icon: Inbox, tone: "teal" } : null,
                withWhatsApp.has(campaign.id) ? { label: "WhatsApp Business", icon: MessageCircle, tone: "green" } : null,
              ].filter(Boolean) as Array<{ label: string; icon: typeof Phone; tone: SectionTone }>;

              return (
                <li key={campaign.id}>
                  <Link
                    href={`/dashboard/campanas/${campaign.id}`}
                    className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-muted/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Avatar name={campaign.name} shape="square" size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{campaign.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {campaign.description ?? "Campaña operativa"}
                      </p>
                    </div>
                    {/* Canales como íconos: se comparan de un vistazo entre filas. */}
                    <div className="hidden items-center gap-1.5 sm:flex">
                      {channels.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Solo registros</span>
                      ) : (
                        channels.map(({ label, icon: Icon, tone }) => (
                          <span key={label} className="icon-chip size-7 rounded-lg" data-tone={tone} title={label}>
                            <Icon size={14} aria-hidden="true" />
                            <span className="sr-only">{label}</span>
                          </span>
                        ))
                      )}
                    </div>
                    <ChevronRight
                      className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary"
                      size={16}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
