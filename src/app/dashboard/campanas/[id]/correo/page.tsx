import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InboundMailbox, type InboundEmailRow } from "@/components/inbound-mailbox";
import { PageHeader } from "@/components/ui";

type AgentOption = { id: string; full_name: string; email: string };

export default async function CampaignInboxPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  if (profile.role === "supervisor") {
    const { data: scope } = await supabase.rpc("get_report_scope_campaigns");
    if (!(scope ?? []).some((campaign: { id: string }) => campaign.id === id)) notFound();
  }

  const [{ data: campaign }, { data: mailbox, error: mailboxError }] = await Promise.all([
    supabase.from("campaigns").select("id,name").eq("id", id).single(),
    supabase
      .from("inbound_mailboxes")
      .select("id,address,label,campaign_id,last_synced_at,last_sync_error")
      .eq("campaign_id", id)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (mailboxError) throw new Error(mailboxError.message);
  if (!campaign || !mailbox) notFound();

  const [{ data: messages, error: messagesError }, { data: memberships }] = await Promise.all([
    supabase
      .from("inbound_emails")
      .select("id,from_name,from_address,subject,body_text,preview,detected_phone,received_at,status,lead_id")
      .eq("mailbox_id", mailbox.id)
      .order("received_at", { ascending: false })
      .limit(100),
    supabase.from("campaign_agents").select("profile_id").eq("campaign_id", id),
  ]);
  if (messagesError) throw new Error(messagesError.message);

  const memberIds = (memberships ?? []).map((membership) => membership.profile_id);
  let agents: AgentOption[] = [];
  if (memberIds.length > 0) {
    const agentsQuery = supabase
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "agente")
      .eq("active", true)
      .in("id", memberIds)
      .order("full_name");

    if (profile.role === "supervisor") {
      const { data: supervisedTeams } = await supabase.from("teams").select("id").eq("supervisor_id", profile.id);
      const teamIds = (supervisedTeams ?? []).map((team) => team.id);
      if (teamIds.length > 0) agentsQuery.in("team_id", teamIds);
      else agentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }

    const { data, error } = await agentsQuery;
    if (error) throw new Error(error.message);
    agents = (data ?? []) as AgentOption[];
  }

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/campanas/${id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft size={13} /> {campaign.name}
      </Link>
      <PageHeader
        title={`Bandeja de entrada · ${campaign.name}`}
        description="Consulta y convierte correos recibidos en registros para contacto telefónico."
      />
      <InboundMailbox
        mailbox={mailbox}
        campaignName={campaign.name}
        messages={(messages ?? []) as InboundEmailRow[]}
        agents={agents}
      />
    </div>
  );
}
