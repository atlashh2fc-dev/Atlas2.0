import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CampaignDashboard } from "@/components/campaign-dashboard";
import type { CampaignDashboardCall } from "@/lib/types";

type ProfileEmbed = { full_name: string } | { full_name: string }[] | null;
type LeadEmbed = { full_name: string; campaign_id: string | null } | { full_name: string; campaign_id: string | null }[] | null;

const DASHBOARD_WINDOW_DAYS = 30;

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function CampaignDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const dashboardTo = endOfDay(new Date());
  const dashboardFrom = startOfDay(addDays(dashboardTo, -(DASHBOARD_WINDOW_DAYS - 1)));
  const loadedFrom = startOfDay(addDays(dashboardFrom, -DASHBOARD_WINDOW_DAYS));

  const [{ data: rawCalls, error: callsError }, { count: leadCount }, { data: agentMembers }] = await Promise.all([
    supabase
      .from("calls")
      .select(
        `id, status, outcome, reason, equifax_products, equifax_uf_amount, next_action_at, started_at, ended_at,
         agent_id, profiles!calls_agent_id_fkey(full_name),
         lead_id, leads!inner(full_name, campaign_id)`
      )
      .eq("leads.campaign_id", id)
      .gte("started_at", loadedFrom.toISOString())
      .lte("started_at", dashboardTo.toISOString())
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
        initialDateFrom={dateInputValue(dashboardFrom)}
        initialDateTo={dateInputValue(dashboardTo)}
        loadedDateFrom={dateInputValue(loadedFrom)}
        loadedDateTo={dateInputValue(dashboardTo)}
      />
    </div>
  );
}
