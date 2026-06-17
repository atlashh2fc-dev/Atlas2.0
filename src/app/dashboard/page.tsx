import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LiveDashboard } from "@/components/live-dashboard";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { count: totalLeads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });

  const { count: enGestion } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("status", "en_gestion");

  const { count: convertidos } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("status", "convertido");

  const { data: recientes } = await supabase
    .from("interactions")
    .select("id, result, created_at, leads(full_name)")
    .order("created_at", { ascending: false })
    .limit(5);

  const initialRecent = (recientes ?? []).map((r) => ({
    id: r.id,
    result: r.result,
    created_at: r.created_at,
    lead_name: (r as unknown as { leads: { full_name: string } | null }).leads?.full_name ?? "Lead",
  }));

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

      <LiveDashboard
        initialStats={{
          total: totalLeads ?? 0,
          enGestion: enGestion ?? 0,
          convertidos: convertidos ?? 0,
        }}
        initialRecent={initialRecent}
      />
    </div>
  );
}
