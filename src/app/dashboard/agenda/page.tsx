import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { Callout, PageHeader } from "@/components/ui";
import { AgendaTable, type AgendaRow } from "@/components/agenda-table";

export default async function MyAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const profile = await requireProfile(["agente"]);
  const { campaign } = await searchParams;
  const campaignScope = await resolveCampaignScope(campaign);
  const supabase = await createClient();

  // El embed tiene que nombrar la clave foránea: `campaigns(name)` es ambiguo
  // (hay más de una relación entre leads y campaigns) y PostgREST responde
  // PGRST201, lo que dejaba esta pantalla siempre vacía sin avisar.
  const leadsQuery = supabase
    .from("leads")
    .select(
      "id, full_name, rut, phone, next_action_at, tipificacion_actual, callback_mode, callback_attempts, workflow_status, campaigns!leads_campaign_id_fkey(name)"
    )
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
      // Un compromiso personal te llega solo: el discador marca al cliente a la
      // hora acordada y la llamada te entra a ti.
      auto: lead.workflow_status === "callback" && (lead.callback_mode ?? "personal") === "personal",
      attempts: lead.callback_attempts ?? 0,
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
            ? `Tus compromisos con clientes. Tienes ${overdueCount} ${overdueCount === 1 ? "vencido" : "vencidos"} por recuperar.`
            : "Tus compromisos con clientes, los más urgentes primero."
        }
      />

      <Callout tone="info">
        A la hora que agendaste, el sistema llama al cliente y la llamada te entra a ti. Para que ocurra tienes que
        estar conectado y en Disponible; si estás en llamada o en pausa, se reintenta durante los minutos siguientes.
        También puedes llamar antes con el botón de cada fila.
      </Callout>
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
