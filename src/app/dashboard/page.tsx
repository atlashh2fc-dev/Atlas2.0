import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";
import type { HomeDashboardSummary } from "@/lib/types";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_home_dashboard_summary");
  if (error) throw new Error(error.message);
  const summary = data as HomeDashboardSummary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Hola, {profile.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Esto es lo que está pasando con tus leads hoy.
        </p>
      </div>

      <LiveDashboard initialSummary={summary} />
    </div>
  );
}
