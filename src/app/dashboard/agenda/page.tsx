import { CalendarCheck, CalendarClock, CalendarX2, PhoneOutgoing } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveCampaignScope } from "@/lib/campaign-scope";
import { getMyAgendaCampaignId } from "@/lib/agenda-scope";
import { Callout, PageHeader } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
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
  if (error) console.error("No se pudo cargar la agenda del ejecutivo", error);

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

  // Próximas y vencidas en tablas separadas: con una sola lista paginada y las
  // vencidas primero, quien acumulaba muchas no encontraba lo que acababa de
  // agendar (82 vencidas empujaban las próximas a la página 4).
  const upcoming = rows.filter((row) => !row.overdue);
  // La vencida más reciente arriba: es la que todavía se puede recuperar.
  const overdueRows = rows.filter((row) => row.overdue).reverse();
  const overdueCount = overdueRows.length;
  const autoCount = upcoming.filter((row) => row.auto).length;
  // Una línea en el encabezado: el detalle del reintento vive en el sistema,
  // no en la pantalla.

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CalendarCheck}
        title="Mi agenda"
        description={
          overdueCount > 0
            ? `Tus compromisos con clientes. Lo primero: ${overdueCount} ${overdueCount === 1 ? "vencido" : "vencidos"} por recuperar.`
            : "Tus compromisos con clientes, los más urgentes primero."
        }
        meta={
          <span className="inline-flex items-center gap-1.5">
            <PhoneOutgoing size={13} aria-hidden="true" />
            Si estás Disponible, tus llamadas agendadas se marcan solas a la hora acordada; «Llamar ahora» la adelanta.
          </span>
        }
      />

      {error ? (
        <Callout tone="danger">
          No se pudo cargar tu agenda. Actualiza la página; si sigue igual, avisa a tu supervisor.
        </Callout>
      ) : (
        <>
          <KpiStrip columns={3}>
            <KpiStripItem
              label="Vencidas por recuperar"
              icon={CalendarX2}
              value={overdueCount.toLocaleString("es-CL")}
              tone={overdueCount > 0 ? "danger" : "default"}
              detail={overdueCount > 0 ? "La más reciente es la que todavía se recupera" : "Nada pendiente"}
            />
            <KpiStripItem
              label="Próximas"
              icon={CalendarClock}
              value={upcoming.length.toLocaleString("es-CL")}
              detail="Compromisos por venir"
            />
            <KpiStripItem
              label="Las marca el discador"
              icon={PhoneOutgoing}
              value={autoCount.toLocaleString("es-CL")}
              detail="Llamadas que salen solas a su hora"
              progress={upcoming.length > 0 ? (autoCount / upcoming.length) * 100 : undefined}
            />
          </KpiStrip>

          {/* Próximas primero: lo recién agendado no puede quedar debajo de
              decenas de vencidas. La cifra de vencidas ya está arriba. */}
          <section className="space-y-3">
            <AgendaHeading title="Próximas" count={upcoming.length} />
            <AgendaTable rows={upcoming} storageKey="agenda" />
          </section>
          {overdueCount > 0 && (
            <section className="space-y-3">
              <AgendaHeading title="Vencidas por recuperar" count={overdueCount} tone="danger" />
              <AgendaTable rows={overdueRows} storageKey="agenda-vencidas" />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Título de tabla con su conteo en caja; la tabla trae su propia tarjeta. */
function AgendaHeading({ title, count, tone }: { title: string; count: number; tone?: "danger" }) {
  return (
    <h2 className="flex items-center gap-2 px-1 text-[15px] font-semibold tracking-tight text-foreground">
      {tone === "danger" && <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />}
      {title}
      <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
        {count.toLocaleString("es-CL")}
      </span>
    </h2>
  );
}
