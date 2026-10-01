import Link from "next/link";
import { AlarmClock, CalendarClock, ChevronRight, PhoneOff, UserRoundCheck } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyAgendaCampaignId } from "@/lib/agenda-scope";
import { AgendaTable, type AgendaRow } from "@/components/agenda-table";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Avatar, Callout, EmptyState, SectionCard, buttonClasses } from "@/components/ui";
import { getCampaignsWithChannel } from "@/lib/campaign-channels";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";

type LeadRow = {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  next_action_at: string | null;
  next_action_channel: string | null;
  extra: Record<string, unknown> | null;
  tipificacion_actual: string | null;
  callback_mode: string | null;
  callback_attempts: number | null;
  workflow_status: string | null;
  campaigns: { name: string } | { name: string }[] | null;
};

/** "VOLVER A LLAMAR" → "Volver a llamar": las tipificaciones llegan en mayúsculas desde la base. */
function enOracion(texto: string): string {
  if (texto !== texto.toUpperCase()) return texto;
  const minusculas = texto.toLocaleLowerCase("es-CL");
  return minusculas.charAt(0).toLocaleUpperCase("es-CL") + minusculas.slice(1);
}

function campaignName(value: LeadRow["campaigns"]): string {
  const embedded = Array.isArray(value) ? value[0] : value;
  return embedded?.name ?? "Sin campaña";
}

/**
 * Cola de voz del ejecutivo.
 *
 * Es la pestaña que faltaba: en 17 de las 18 campañas la atención es
 * telefónica, y el puesto de atención solo sabía abrir WhatsApp. Marca el
 * discador y la barra CTI del layout, así que acá no se re-implementa la
 * llamada: esto es la cola que la alimenta.
 */
export default async function VoiceQueuePage() {
  const profile = await requireProfile();
  const permissions = getWorkspacePermissions(profile.role);
  const supabase = await createClient();

  const voiceCampaigns = await getCampaignsWithChannel(supabase, profile, "phone");
  if (voiceCampaigns.length === 0) {
    return (
      <EmptyState
        icon={PhoneOff}
        title="Sin campañas de voz"
        description="Ninguna de tus campañas tiene el canal de voz habilitado."
      />
    );
  }

  // El embed nombra la clave foránea: `campaigns(name)` es ambiguo porque hay
  // más de una relación entre leads y campaigns, y PostgREST responde PGRST201.
  const select =
    "id, full_name, rut, phone, next_action_at, next_action_channel, extra, tipificacion_actual, callback_mode, callback_attempts, workflow_status, campaigns!leads_campaign_id_fkey(name)";

  const agendaQuery = supabase
    .from("leads")
    .select(select)
    .in("campaign_id", voiceCampaigns)
    .not("next_action_at", "is", null)
    .not("phone", "is", null)
    .neq("phone", "")
    .order("next_action_at", { ascending: true })
    .limit(500);

  // El ejecutivo atiende lo suyo; supervisión consulta lo de sus equipos y la
  // RLS ya acota `leads` a los equipos supervisados.
  if (permissions.canAttendCustomers) {
    agendaQuery.eq("managed_by", profile.id);
    // Solo la campaña en la que está trabajando (multiskill), como "Mi agenda".
    const agendaCampaignId = await getMyAgendaCampaignId(supabase);
    if (agendaCampaignId) agendaQuery.eq("campaign_id", agendaCampaignId);
  }

  const pendingQuery = supabase
    .from("leads")
    // La lista muestra 25, pero la cifra de "Sin trabajar" es el total real.
    .select("id, full_name, rut, phone, tipificacion_actual, campaigns!leads_campaign_id_fkey(name)", { count: "exact" })
    .in("campaign_id", voiceCampaigns)
    .is("next_action_at", null)
    .is("managed_at", null)
    .not("phone", "is", null)
    .neq("phone", "")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (permissions.canAttendCustomers) pendingQuery.eq("assigned_to", profile.id);

  const [{ data: agendaLeads, error }, { data: pendingLeads, count: pendingCount }] = await Promise.all([
    agendaQuery,
    pendingQuery,
  ]);

  if (error) console.error("No se pudo cargar la cola de voz", error);

  // Mismo criterio que /dashboard/agenda: vencido es "su hora ya pasó".
  const now = new Date().getTime();
  const rows: AgendaRow[] = ((agendaLeads ?? []) as LeadRow[]).map((lead) => ({
    id: lead.id,
    full_name: lead.full_name,
    contact: lead.rut ?? lead.phone ?? "—",
    campaign: campaignName(lead.campaigns),
    tipificacion: lead.tipificacion_actual ?? "—",
    next_action_at: lead.next_action_at!,
    overdue: new Date(lead.next_action_at!).getTime() <= now,
    auto:
      (lead.next_action_channel ?? "phone") === "phone" &&
      lead.workflow_status === "callback" &&
      (lead.callback_mode ?? "personal") === "personal",
    attempts: lead.callback_attempts ?? 0,
    channel: (lead.next_action_channel ?? "phone") as AgendaRow["channel"],
    conversationId: null,
  }));

  const overdue = rows.filter((row) => row.overdue);
  const ordered = [...overdue, ...rows.filter((row) => !row.overdue)];
  const pending = (pendingLeads ?? []) as Pick<
    LeadRow,
    "id" | "full_name" | "rut" | "phone" | "tipificacion_actual" | "campaigns"
  >[];
  const pendingTotal = pendingCount ?? pending.length;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {permissions.canAttendCustomers
          ? "Tus compromisos telefónicos y los registros asignados que aún no has trabajado. Las llamadas se marcan desde la barra inferior."
          : "Compromisos telefónicos y registros sin trabajar de tus equipos, en las campañas con voz habilitada."}
      </p>

      {error && (
        <Callout tone="danger">
          No se pudieron cargar tus compromisos telefónicos. Actualiza la página; si sigue igual, avisa a tu supervisor.
        </Callout>
      )}

      <KpiStrip columns={3}>
        <KpiStripItem
          label="Vencidos"
          value={overdue.length.toLocaleString("es-CL")}
          icon={AlarmClock}
          tone={overdue.length > 0 ? "danger" : "default"}
          detail={overdue.length > 0 ? "Su hora ya pasó: van primero en la lista" : "Nada atrasado"}
        />
        <KpiStripItem
          label="Agendados"
          value={(rows.length - overdue.length).toLocaleString("es-CL")}
          icon={CalendarClock}
          detail="Compromisos por venir"
        />
        <KpiStripItem
          label="Sin trabajar"
          value={pendingTotal.toLocaleString("es-CL")}
          icon={UserRoundCheck}
          tone={pendingTotal > 0 ? "warn" : "default"}
          detail="Asignados sin gestión ni agenda"
        />
      </KpiStrip>

      <SectionCard
        title="Compromisos telefónicos"
        description="Vencidos primero; dentro de cada grupo, el más urgente arriba."
      >
        <AgendaTable rows={ordered} />
      </SectionCard>

      <SectionCard
        title="Asignados sin trabajar"
        description={
          pendingTotal > pending.length
            ? `Registros con teléfono que todavía no tienen gestión ni agenda. Se ven los ${pending.length} más recientes de ${pendingTotal.toLocaleString("es-CL")}.`
            : "Registros con teléfono que todavía no tienen gestión ni agenda."
        }
        actions={
          <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Ver todos
          </Link>
        }
      >
        {pending.length === 0 ? (
          <EmptyState
            icon={UserRoundCheck}
            title="Nada pendiente"
            description="No hay registros asignados sin trabajar en tus campañas de voz."
          />
        ) : (
          <ul className="divide-y divide-border/70 border-t border-border">
            {pending.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-muted/55"
                >
                  <Avatar name={lead.full_name} seed={lead.rut ?? lead.full_name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground group-hover:text-primary">{lead.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="tabular-nums">{lead.rut ?? lead.phone ?? "—"}</span> · {campaignName(lead.campaigns)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {lead.tipificacion_actual ? enOracion(lead.tipificacion_actual) : "Sin gestión"}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
