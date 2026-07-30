import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { PageHeader } from "@/components/ui";
import { AgendaTable, type AgendaRow } from "@/components/agenda-table";

export default async function MyAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const profile = await requireProfile(["agente", "admin"]);
  const { campaign } = await searchParams;
  const campaignScope = await resolveCampaignScope(campaign);
  const supabase = await createClient();

  // El embed tiene que nombrar la clave foránea: `campaigns(name)` es ambiguo
  // (hay más de una relación entre leads y campaigns) y PostgREST responde
  // PGRST201, lo que dejaba esta pantalla siempre vacía sin avisar.
  const leadsQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, next_action_at, tipificacion_actual, campaigns!leads_campaign_id_fkey(name)")
    .eq("managed_by", profile.id)
    .not("next_action_at", "is", null)
    .order("next_action_at", { ascending: true })
    .limit(500);
  if (campaignScope) leadsQuery.eq("campaign_id", campaignScope);
  const { data: leads, error } = await leadsQuery;

  const now = new Date().getTime();
  const rows: AgendaRow[] = (leads ?? []).map((lead) => {
    // El embed uno-a-uno llega como objeto; el array es solo la forma que usa
    // PostgREST cuando la relación es de varios.
    const embedded = lead.campaigns as { name: string } | { name: string }[] | null;
    const campaign = Array.isArray(embedded) ? embedded[0]?.name : embedded?.name;
    return {
      id: lead.id,
      full_name: lead.full_name,
      contact: lead.rut ?? lead.phone ?? "—",
      campaign: campaign ?? "Sin campaña",
      tipificacion: lead.tipificacion_actual ?? "—",
      next_action_at: lead.next_action_at!,
      overdue: new Date(lead.next_action_at!).getTime() <= now,
    };
  });

  // Vencidas primero; dentro de cada grupo, la más urgente arriba.
  const ordered = [...rows.filter((row) => row.overdue), ...rows.filter((row) => !row.overdue)];
  const overdueCount = rows.filter((row) => row.overdue).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mi agenda"
        description={
          overdueCount > 0
            ? `Tus próximas llamadas agendadas. Tienes ${overdueCount} ${overdueCount === 1 ? "vencida" : "vencidas"} por recuperar.`
            : "Tus próximas llamadas agendadas, vencidas primero."
        }
      />
      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          No se pudo cargar tu agenda: {error.message}
        </p>
      ) : (
        <AgendaTable rows={ordered} />
      )}
    </div>
  );
}
