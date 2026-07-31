import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { DialerListener } from "@/components/dialer-listener";
import { AgendaBanner, AgendaProvider } from "@/components/agenda-reminder";
import { CtiBar } from "@/components/cti-bar";
import { ToastProvider } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const showAgendaReminder = profile.role === "agente";
  const supabase = await createClient();
  const [{ data: rawCampaignRows }, { data: memberships }] = await Promise.all([
    profile.role === "agente"
      ? supabase.from("campaigns").select("id, name").eq("is_active", true).order("name")
      : supabase.rpc("get_report_scope_campaigns"),
    profile.role === "agente"
      ? supabase.from("campaign_agents").select("campaign_id").eq("profile_id", profile.id)
      : Promise.resolve({ data: [] as { campaign_id: string }[] }),
  ]);
  const campaignRows = (rawCampaignRows ?? []) as { id: string; name: string }[];
  const assignedCampaignIds = new Set((memberships ?? []).map((membership) => membership.campaign_id));
  const campaigns = campaignRows.filter(
    (campaign) => profile.role !== "agente" || assignedCampaignIds.has(campaign.id)
  );
  const requestedScope = await resolveCampaignScope();
  const selectedCampaignId = campaigns.some((campaign) => campaign.id === requestedScope) ? requestedScope : null;

  // Contador del menú: las agendas vencidas del ejecutivo. Es una cuenta con
  // `head: true`, no trae filas.
  const { count: overdueCount } =
    profile.role === "agente"
      ? await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("managed_by", profile.id)
          .not("next_action_at", "is", null)
          .lte("next_action_at", new Date().toISOString())
      : { count: null };

  const badges = { "overdue-agenda": overdueCount ?? 0 };

  return (
    <ToastProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <DialerListener userId={profile.id} />
        <Sidebar profile={profile} badges={badges} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {showAgendaReminder ? (
            <AgendaProvider userId={profile.id}>
              <Header
                profile={profile}
                campaigns={campaigns}
                selectedCampaignId={selectedCampaignId}
                badges={badges}
              />
              <AgendaBanner />
            </AgendaProvider>
          ) : (
            <Header profile={profile} campaigns={campaigns} selectedCampaignId={selectedCampaignId} />
          )}
          <main className="flex-1 overflow-y-auto p-5">{children}</main>
        </div>
        <CtiBar profile={profile} />
      </div>
    </ToastProvider>
  );
}
