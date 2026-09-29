import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCallReasonCatalogFromWorkflow } from "@/lib/call-typification";
import { fetchCampaignAgendaPolicy } from "@/lib/campaign-agenda-policy";
import { getCampaignAppointmentScheduleUrl } from "@/lib/campaign-appointment-schedules";
import { leadContactPerson } from "@/lib/lead-extra";
import type { Campaign, Lead, WorkflowStep, WorkflowStepBranch } from "@/lib/types";

/**
 * Lo que el formulario de tipificación necesita de un registro, armado igual
 * que en la ficha: el catálogo de motivos del flujo de la campaña, la política
 * de agenda, los campos comerciales de Equifax y el cliente para el cotizador.
 * Lo usa la bandeja de correo para tipificar sin salir de la conversación.
 */
export async function contextoDeTipificacion(supabase: SupabaseClient, leadId: string) {
  const { data } = await supabase.rpc("get_lead_360", { p_lead_id: leadId });
  if (!data) return null;
  const record = data as { lead: Lead; campaign: Pick<Campaign, "id" | "name" | "workflow_id"> | null };
  const lead = record.lead;
  const campaign = record.campaign;
  const workflowId = lead.workflow_id ?? campaign?.workflow_id ?? null;

  const [[{ data: pasos }, { data: ramas }], agendaPolicy] = await Promise.all([
    workflowId
      ? Promise.all([
          supabase.from("workflow_steps").select("*").eq("workflow_id", workflowId).order("step_order", { ascending: true }),
          supabase.from("workflow_step_branches").select("*").eq("workflow_id", workflowId),
        ])
      : Promise.resolve([{ data: null }, { data: null }] as const),
    fetchCampaignAgendaPolicy(supabase, lead.campaign_id ?? campaign?.id ?? null),
  ]);

  const reasonCatalog = buildCallReasonCatalogFromWorkflow((pasos ?? []) as WorkflowStep[], (ramas ?? []) as WorkflowStepBranch[]);
  return {
    lead,
    reasonCatalog,
    equifaxCommercialFieldsEnabled: reasonCatalog.some((reason) => reason.requiresEquifaxData === true),
    appointmentScheduleUrl: getCampaignAppointmentScheduleUrl(campaign?.name),
    agendaPolicy,
    quoteClient: {
      empresa: lead.full_name,
      rut: lead.rut,
      contacto: leadContactPerson(lead.extra, lead.full_name),
      correo: lead.email,
      telefono: lead.phone,
    },
  };
}
