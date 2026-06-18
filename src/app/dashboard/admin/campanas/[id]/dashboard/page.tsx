import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CampaignDashboard } from "@/components/campaign-dashboard";
import type { CampaignDashboardCall } from "@/lib/types";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;
type LeadEmbed = { full_name: string; campaign_id: string | null } | { full_name: string; campaign_id: string | null }[] | null;

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function CampaignDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const [{ data: rawCalls, error: callsError }, { count: leadCount }, { data: agentMembers }] = await Promise.all([
    supabase
      .from("calls")
      .select(
        `id, status, outcome, reason, equifax_products, equifax_uf_amount, next_action_at, started_at, ended_at,
         agent_id, profiles!calls_agent_id_fkey(full_name),
         lead_id, leads!inner(full_name, campaign_id)`
      )
      .eq("leads.campaign_id", id)
      .order("started_at", { ascending: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase
      .from("campaign_agents")
      .select("profile_id, profiles(full_name)")
      .eq("campaign_id", id),
  ]);

  if (callsError) throw new Error(callsError.message);

  const calls: CampaignDashboardCall[] = (rawCalls ?? []).map((row) => {
    const profile = one(row.profiles as ProfileEmbed);
    const lead = one(row.leads as LeadEmbed);
    return {
      id: row.id,
      status: row.status,
      outcome: row.outcome,
      reason: row.reason,
      equifax_products: row.equifax_products,
      equifax_uf_amount: row.equifax_uf_amount,
      next_action_at: row.next_action_at,
      started_at: row.started_at,
      ended_at: row.ended_at,
      agent_id: row.agent_id,
      agent_name: profile?.full_name ?? "—",
      lead_id: row.lead_id,
      lead_full_name: lead?.full_name ?? "—",
    };
  });

  const agentOptions = (agentMembers ?? [])
    .map((m) => {
      const profile = one(m.profiles as ProfileEmbed);
      return profile ? { id: m.profile_id as string, name: profile.full_name } : null;
    })
    .filter((a): a is { id: string; name: string } => a !== null);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/admin/campanas/${id}`}
          className="text-xs text-muted-foreground hover:text-primary"
        >
          ← {campaign.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Dashboard de gestión — {campaign.name}</h1>
        <p className="text-sm text-muted-foreground">
          Análisis interactivo de la cascada de tipificación: rendimiento, embudo, motivos, productos y agenda.
        </p>
      </div>

      <CampaignDashboard
        calls={calls}
        totalLeads={leadCount ?? 0}
        agentOptions={agentOptions}
      />
    </div>
  );
}
