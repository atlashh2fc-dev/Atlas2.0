import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CampaignDashboardSummary } from "@/components/campaign-dashboard-summary";
import type { CampaignDashboardSummary as CampaignDashboardSummaryData } from "@/lib/types";

const DASHBOARD_WINDOW_DAYS = 30;

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
  const previousTo = new Date(dashboardFrom.getTime() - 1);

  const { data: summary, error: summaryError } = await supabase.rpc("get_campaign_dashboard_summary", {
    p_campaign_id: id,
    p_from: dashboardFrom.toISOString(),
    p_to: dashboardTo.toISOString(),
    p_previous_from: loadedFrom.toISOString(),
    p_previous_to: previousTo.toISOString(),
  });

  if (summaryError) throw new Error(summaryError.message);
  const dashboardSummary = summary as CampaignDashboardSummaryData;

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

      <CampaignDashboardSummary summary={dashboardSummary} />
    </div>
  );
}
