import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { mapAtlasLeadMailCampaign, setCampaignWorkflow } from "@/app/actions/campaigns";
import { CampaignDashboardSummary, type ContactabilityHour } from "@/components/campaign-dashboard-summary";
import type {
  CampaignDashboardSummary as CampaignDashboardSummaryData,
  AiVoiceCampaignConfig,
  DialerCampaignConfig,
} from "@/lib/types";
import { ActionForm, ActionSubmit, Badge, Card, Field, Input, SectionCard, Select } from "@/components/ui";

const DASHBOARD_WINDOW_DAYS = 30;

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export default async function CampaignSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) notFound();

  const to = endOfDay(new Date());
  const from = startOfDay(addDays(to, -(DASHBOARD_WINDOW_DAYS - 1)));
  const previousFrom = startOfDay(addDays(from, -DASHBOARD_WINDOW_DAYS));
  const previousTo = new Date(from.getTime() - 1);

  const { data: hourly } = await supabase.rpc("get_contactability_by_hour", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_campaign_id: id,
  });

  const [
    { data: summary, error: summaryError },
    { count: leadCount },
    { count: memberCount },
    { data: dialerConfig },
    { data: aiVoiceConfig },
    { data: workflows },
    { data: mailCampaigns },
    { data: campaignMemberships },
  ] = await Promise.all([
    supabase.rpc("get_campaign_dashboard_summary", {
      p_campaign_id: id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_previous_from: previousFrom.toISOString(),
      p_previous_to: previousTo.toISOString(),
    }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("campaign_agents").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("ai_voice_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    // Solo flujos publicados: un borrador no debería quedar operando una campaña.
    supabase.from("workflows").select("id, name").eq("status", "published").order("name"),
    supabase
      .from("mail_campaigns")
      .select("id,name,external_campaign_key,status,metadata,updated_at")
      .eq("campaign_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("campaign_agents").select("profile_id").eq("campaign_id", id),
  ]);

  const memberProfileIds = [...new Set((campaignMemberships ?? []).map((row) => row.profile_id))];
  const { data: memberProfiles } = memberProfileIds.length > 0
    ? await supabase
      .from("profiles")
      .select("team_id,teams(id,name)")
      .in("id", memberProfileIds)
      .eq("active", true)
      .eq("role", "agente")
    : { data: [] };
  const routingTeamsById = new Map<string, { id: string; name: string }>();
  for (const member of memberProfiles ?? []) {
    const team = Array.isArray(member.teams) ? member.teams[0] : member.teams;
    if (member.team_id && team?.id) routingTeamsById.set(team.id, team);
  }
  const routingTeams = [...routingTeamsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "es")
  );

  const dialer = dialerConfig as DialerCampaignConfig | null;
  const aiVoice = aiVoiceConfig as AiVoiceCampaignConfig | null;
  const usesSiptel = dialer?.trunk_context === "siptel";
  const base = `/dashboard/admin/campanas/${id}`;

  const setupItems = [
    {
      label: "Flujo de gestión",
      detail: aiVoice ? "El guion vive en el agente ElevenLabs" : campaign.workflow_id ? "Asignado" : "Asigna el guion que verán los ejecutivos",
      done: aiVoice ? true : Boolean(campaign.workflow_id),
      href: aiVoice ? `${base}/ia` : `${base}#flujo`,
    },
    {
      label: "Ejecutivos",
      detail: aiVoice ? ((memberCount ?? 0) === 0 ? "No aplica · campaña solo IA" : "Retira los ejecutivos asignados") : (memberCount ?? 0) > 0 ? `${memberCount} asignados` : "Asigna al menos un ejecutivo",
      done: aiVoice ? (memberCount ?? 0) === 0 : (memberCount ?? 0) > 0,
      href: aiVoice ? `${base}/ia` : `${base}/ejecutivos`,
    },
    {
      label: "Base de registros",
      detail:
        (leadCount ?? 0) > 0
          ? `${(leadCount ?? 0).toLocaleString("es-CL")} registros`
          : "Carga la base de la campaña",
      done: (leadCount ?? 0) > 0,
      href: `${base}/base`,
    },
    {
      label: "Discador",
      detail: aiVoice
        ? aiVoice.is_active
          ? "Agente ElevenLabs activo"
          : aiVoice.phone_number_id
            ? "Troncal listo; falta iniciar la IA"
            : "Falta conectar el troncal SIP"
        : dialer
        ? !usesSiptel
          ? "Revisa la ruta saliente: solo Siptel está habilitado"
          : dialer.is_active
            ? "Configurado y activo"
            : "Configurado, falta iniciarlo"
        : "Configura la cola y el modo de discado",
      done: aiVoice ? Boolean(aiVoice.is_active && aiVoice.phone_number_id) : Boolean(dialer?.is_active && usesSiptel),
      href: aiVoice ? `${base}/ia` : `${base}/discado`,
    },
  ];
  const pending = setupItems.filter((item) => !item.done).length;

  return (
    <div className="space-y-5">
      <Link className="inline-flex text-sm text-primary underline" href={`/dashboard/calidad/loop?campaign=${id}`}>
        Loop IA · revisar y configurar observación
      </Link>
      <SectionCard
        title="Preparación de la campaña"
        description="Estos cuatro puntos definen si la campaña puede operar."
        actions={
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              pending === 0 ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
            }`}
          >
            {pending === 0 ? "Lista para operar" : `${pending} pendiente${pending === 1 ? "" : "s"}`}
          </span>
        }
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {setupItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary"
            >
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  item.done ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
                }`}
              >
                {item.done ? "Listo" : "Pendiente"}
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Atlas Lead"
        description="Conecta campañas de correo existentes con esta campaña CRM mediante su clave estable. Atlas Lead conserva el envío y tracking; Atlas CRM conserva la asignación y gestión."
        actions={
          (mailCampaigns ?? []).length > 0 ? (
            <Link href={`/dashboard/mail?campaign=${id}`} className="text-xs font-medium text-primary hover:underline">
              Abrir señales de correo
            </Link>
          ) : undefined
        }
      >
        <div className="space-y-4 p-4">
          {(mailCampaigns ?? []).length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {(mailCampaigns ?? []).map((mailCampaign) => (
                <li key={mailCampaign.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{mailCampaign.name}</p>
                    <p className="mt-0.5 break-all text-xs text-muted-foreground">{mailCampaign.external_campaign_key}</p>
                  </div>
                  <Badge tone={mailCampaign.metadata?.readiness === "ready" ? "success" : "warning"}>
                    {mailCampaign.metadata?.readiness === "ready" ? "Lista para recibir" : "Habilitación pendiente"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          <ActionForm
            action={mapAtlasLeadMailCampaign}
            success="Vínculo Atlas Lead registrado"
            className="grid gap-3 rounded-lg border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] xl:items-end"
          >
            <input type="hidden" name="campaign_id" value={id} />
            <Field label="Clave externa de Atlas Lead">
              <Input name="external_campaign_key" required maxLength={36} placeholder="UUID de la campaña Atlas Lead" />
            </Field>
            <Field label="Nombre visible del envío">
              <Input name="mail_campaign_name" required maxLength={200} placeholder="Campaña · Envío 1" />
            </Field>
            <Field label="Equipo de recepción">
              <Select name="routing_team_id" required defaultValue={routingTeams[0]?.id ?? ""}>
                {routingTeams.length === 0 && <option value="">Asigna primero un ejecutivo</option>}
                {routingTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </Select>
            </Field>
            <ActionSubmit disabled={routingTeams.length === 0} pendingLabel="Conectando…">Registrar y habilitar</ActionSubmit>
          </ActionForm>
          <p className="text-xs text-muted-foreground">
            Esta acción no crea una campaña CRM nueva ni envía correos. El equipo seleccionado recibe los contactos nuevos y la exportación sólo queda lista después de la confirmación segura de Atlas Lead.
          </p>
        </div>
      </SectionCard>

      {!aiVoice && <div id="flujo" />}
      {!aiVoice && <SectionCard
        title="Flujo de gestión"
        description="Es el guion que los ejecutivos siguen al atender los registros de esta campaña."
      >
        <ActionForm
          action={setCampaignWorkflow}
          success="Flujo asignado"
          className="flex flex-wrap items-end gap-3 p-4"
        >
          <input type="hidden" name="campaign_id" value={id} />
          <Field label="Flujo asignado" className="w-72">
            <Select name="workflow_id" defaultValue={campaign.workflow_id ?? ""}>
              <option value="">Sin flujo asignado</option>
              {(workflows ?? []).map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </Select>
          </Field>
          <ActionSubmit pendingLabel="Guardando…">Guardar</ActionSubmit>
          <Link
            href={`/dashboard/admin/flujos?campaign_id=${id}`}
            className="pb-2 text-xs font-medium text-primary hover:underline"
          >
            Editar o crear un flujo
          </Link>
        </ActionForm>
      </SectionCard>}

      {summaryError ? (
        <Card className="text-sm text-danger">No se pudo cargar el resumen: {summaryError.message}</Card>
      ) : (
        <CampaignDashboardSummary
          summary={summary as CampaignDashboardSummaryData}
          hourly={(hourly ?? []) as ContactabilityHour[]}
        />
      )}
    </div>
  );
}
