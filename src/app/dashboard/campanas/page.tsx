import Link from "next/link";
import { ChevronRight, Mail, Megaphone, Phone, Users } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { campaignCapabilityKey } from "@/lib/campaign-capabilities";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader, SectionCard } from "@/components/ui";

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

  const [mailResult, mailboxResult, dialerResult, leadCounts] = ids.length > 0
    ? await Promise.all([
        supabase.from("mail_campaigns").select("campaign_id,umbrella_key").eq("status", "active"),
        supabase.from("inbound_mailboxes").select("campaign_id").in("campaign_id", ids).eq("active", true),
        supabase.from("dialer_campaign_configs").select("campaign_id").in("campaign_id", ids),
        Promise.all(
          ids.map(async (id) => {
            const { count } = await supabase
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("campaign_id", id);
            return [id, count ?? 0] as const;
          })
        ),
      ])
    : [
        { data: [] as { campaign_id: string; umbrella_key: string }[] },
        { data: [] as { campaign_id: string }[] },
        { data: [] as { campaign_id: string }[] },
        [] as ReadonlyArray<readonly [string, number]>,
      ];

  const withMailSignals = new Set((mailResult.data ?? []).map((row) => row.campaign_id));
  const mailUmbrellas = new Set((mailResult.data ?? []).map((row) => row.umbrella_key));
  for (const campaign of campaigns) {
    if (mailUmbrellas.has(campaignCapabilityKey(campaign.name))) withMailSignals.add(campaign.id);
  }
  const withMailbox = new Set((mailboxResult.data ?? []).map((row) => row.campaign_id));
  const withPhone = new Set((dialerResult.data ?? []).map((row) => row.campaign_id));
  const countByCampaign = new Map(leadCounts);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campañas"
        description="Selecciona una campaña para trabajar con sus registros y canales habilitados."
      />

      <SectionCard>
        <div className="divide-y divide-border">
          {campaigns.length === 0 && (
            <div className="px-5 py-12 text-center">
              <Megaphone className="mx-auto text-muted-foreground/60" size={30} />
              <p className="mt-3 font-medium text-foreground">No hay campañas operativas</p>
              <p className="mt-1 text-sm text-muted-foreground">Revisa la asignación o el estado de las campañas.</p>
            </div>
          )}

          {campaigns.map((campaign) => {
            const channels = [
              withPhone.has(campaign.id) ? { label: "Teléfono", icon: Phone } : null,
              withMailSignals.has(campaign.id) ? { label: "Señales de correo", icon: Mail } : null,
              withMailbox.has(campaign.id) ? { label: "Bandeja de entrada", icon: Mail } : null,
            ].filter(Boolean) as Array<{ label: string; icon: typeof Phone }>;

            return (
              <Link
                key={campaign.id}
                href={`/dashboard/campanas/${campaign.id}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-muted/60"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Megaphone size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground group-hover:text-primary">{campaign.name}</p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {campaign.description ?? `${(countByCampaign.get(campaign.id) ?? 0).toLocaleString("es-CL")} registros`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="neutral"><Users size={12} className="mr-1" /> Registros</Badge>
                    {channels.map(({ label, icon: Icon }) => (
                      <Badge key={label} tone="info"><Icon size={12} className="mr-1" /> {label}</Badge>
                    ))}
                  </div>
                </div>
                <ChevronRight className="shrink-0 text-muted-foreground group-hover:text-primary" size={18} />
              </Link>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
