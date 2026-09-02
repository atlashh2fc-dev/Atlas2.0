import Link from "next/link";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AgendaTable, type AgendaRow } from "@/components/agenda-table";
import { Callout, EmptyState, SectionCard, StatCard, buttonClasses } from "@/components/ui";
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
  if (permissions.canAttendCustomers) agendaQuery.eq("managed_by", profile.id);

  const pendingQuery = supabase
    .from("leads")
    .select("id, full_name, rut, phone, tipificacion_actual, campaigns!leads_campaign_id_fkey(name)")
    .in("campaign_id", voiceCampaigns)
    .is("next_action_at", null)
    .is("managed_at", null)
    .not("phone", "is", null)
    .neq("phone", "")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (permissions.canAttendCustomers) pendingQuery.eq("assigned_to", profile.id);

  const [{ data: agendaLeads, error }, { data: pendingLeads }] = await Promise.all([
    agendaQuery,
    pendingQuery,
  ]);

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

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {permissions.canAttendCustomers
          ? "Tus compromisos telefónicos y los registros asignados que aún no has trabajado. Las llamadas se marcan desde la barra inferior."
          : "Compromisos telefónicos y registros sin trabajar de tus equipos, en las campañas con voz habilitada."}
      </p>

      {error && (
        <Callout tone="danger">{`No se pudo cargar la cola de voz: ${error.message}`}</Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Vencidos" value={String(overdue.length)} />
        <StatCard label="Agendados" value={String(rows.length - overdue.length)} />
        <StatCard label="Sin trabajar" value={String(pending.length)} />
      </div>

      <SectionCard
        title="Compromisos telefónicos"
        description="Vencidos primero; dentro de cada grupo, el más urgente arriba."
      >
        <AgendaTable rows={ordered} />
      </SectionCard>

      <SectionCard
        title="Asignados sin trabajar"
        description="Registros con teléfono que todavía no tienen gestión ni agenda."
        actions={
          <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Ver todos
          </Link>
        }
      >
        {pending.length === 0 ? (
          <EmptyState
            title="Nada pendiente"
            description="No hay registros asignados sin trabajar en tus campañas de voz."
          />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{lead.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {`${lead.rut ?? lead.phone ?? "—"} · ${campaignName(lead.campaigns)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {lead.tipificacion_actual ?? "Sin gestión"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
