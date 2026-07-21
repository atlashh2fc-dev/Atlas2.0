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
  const [{ data: campaignRows }, { data: memberships }] = await Promise.all([
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
    profile.role === "agente"
      ? supabase.from("campaign_agents").select("campaign_id").eq("profile_id", profile.id)
      : Promise.resolve({ data: [] as { campaign_id: string }[] }),
  ]);
  const assignedCampaignIds = new Set((memberships ?? []).map((membership) => membership.campaign_id));
  const campaigns = (campaignRows ?? []).filter(
    (campaign) => profile.role !== "agente" || assignedCampaignIds.has(campaign.id)
  );
  const requestedScope = await resolveCampaignScope();
  const selectedCampaignId = campaigns.some((campaign) => campaign.id === requestedScope) ? requestedScope : null;

  return (
    <ToastProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <DialerListener userId={profile.id} />
        <Sidebar profile={profile} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {showAgendaReminder ? (
            <AgendaProvider userId={profile.id}>
              <Header profile={profile} campaigns={campaigns} selectedCampaignId={selectedCampaignId} />
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
