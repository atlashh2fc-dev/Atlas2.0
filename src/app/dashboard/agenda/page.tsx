import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { getMyAgendaCampaignId } from "@/lib/agenda-scope";
import { Callout, PageHeader } from "@/components/ui";
import { AgendaTable, type AgendaRow } from "@/components/agenda-table";

export default async function MyAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const profile = await requireProfile(["agente"]);
  const { campaign } = await searchParams;
  const supabase = await createClient();
  // Sin ?campaign= manda la campaña en la que está trabajando (multiskill).
  const campaignScope = resolveCampaignScope(campaign) ?? (await getMyAgendaCampaignId(supabase));

  // El embed tiene que nombrar la clave foránea: `campaigns(name)` es ambiguo
  // (hay más de una relación entre leads y campaigns) y PostgREST responde
  // PGRST201, lo que dejaba esta pantalla siempre vacía sin avisar.
  const leadsQuery = supabase
    .from("leads")
    .select(
      "id, full_name, rut, phone, next_action_at, next_action_channel, extra, tipificacion_actual, callback_mode, callback_attempts, workflow_status, campaigns!leads_campaign_id_fkey(name)",
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
      // Solo las llamadas telefónicas entran al discador. WhatsApp y reuniones
      // quedan visibles como compromisos manuales del responsable.
      auto: (lead.next_action_channel ?? "phone") === "phone"
        && lead.workflow_status === "callback"
        && (lead.callback_mode ?? "personal") === "personal",
      attempts: lead.callback_attempts ?? 0,
      channel: (lead.next_action_channel ?? "phone") as AgendaRow["channel"],
      conversationId: typeof lead.extra === "object" && lead.extra !== null
        && typeof (lead.extra as Record<string, unknown>).agenda_conversation_id === "string"
        ? String((lead.extra as Record<string, unknown>).agenda_conversation_id)
        : null,
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
        A la hora acordada, si estás Disponible, el sistema marca automáticamente tus compromisos telefónicos: primero
        suena tu teléfono y, al contestar, se llama al cliente. Se marcan de a uno y en orden. Si ya hablaste con el
        cliente no se vuelve a marcar, y si no contesta se reintenta como máximo una vez más. Con «Llamar ahora» lo
        llamas tú en cualquier momento y el sistema deja de marcarlo. Los seguimientos por WhatsApp abren el chat para
        que los gestiones tú.
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
