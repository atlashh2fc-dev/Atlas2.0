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

  // Agendas pendientes del propio ejecutivo: vencidas o para hoy.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const { data: agendaLeads } = await supabase
    .from("leads")
    .select("id, full_name, rut, phone, next_action_at")
    .eq("managed_by", profile.id)
    .not("next_action_at", "is", null)
    .lte("next_action_at", endOfToday.toISOString())
    .order("next_action_at", { ascending: true })
    .limit(20);

  const initialAgenda = (agendaLeads ?? []).map((l) => ({
    id: l.id,
    full_name: l.full_name,
    rut: l.rut,
    phone: l.phone,
    next_action_at: l.next_action_at as string,
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
        userId={profile.id}
        initialStats={{
          total: totalLeads ?? 0,
          enGestion: enGestion ?? 0,
          convertidos: convertidos ?? 0,
        }}
        initialRecent={initialRecent}
        initialAgenda={initialAgenda}
      />
    </div>
  );
}
