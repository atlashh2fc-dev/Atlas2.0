import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Database, Mail, PhoneCall, Sparkles, Users, Workflow } from "lucide-react";
import { mapAtlasLeadMailCampaign, setCampaignVertical, setCampaignWorkflow } from "@/app/actions/campaigns";
import { CAMPAIGN_VERTICALS, parseCampaignVertical } from "@/lib/campaign-vertical";
import { CampaignDashboardSummary, type ContactabilityHour } from "@/components/campaign-dashboard-summary";
import type {
  CampaignDashboardSummary as CampaignDashboardSummaryData,
  AiVoiceCampaignConfig,
  DialerCampaignConfig,
  SecretariaVirtualChannelFunnelRow,
} from "@/lib/types";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, Field, Input, SectionCard, Select } from "@/components/ui";
import { Grupo, PieDeFormulario } from "../../_diseno";
import { isSecretariaVirtualAuditCampaign } from "@/lib/secretaria-virtual-quality-rubric";

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
  const campaignVertical = parseCampaignVertical(campaign.vertical);

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
    { data: channelFunnel },
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
    isSecretariaVirtualAuditCampaign(campaign.name)
      ? supabase.rpc("get_secretaria_virtual_channel_funnel", {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        })
      : Promise.resolve({ data: null, error: null }),
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

  if (summaryError) console.error("[admin/campanas/resumen] get_campaign_dashboard_summary", summaryError);

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
      icon: Workflow,
      detail: aiVoice ? "El guion vive en el agente ElevenLabs" : campaign.workflow_id ? "Asignado" : "Asigna el guion que verán los ejecutivos",
      done: aiVoice ? true : Boolean(campaign.workflow_id),
      href: aiVoice ? `${base}/ia` : `${base}#flujo`,
    },
    {
      label: "Ejecutivos",
      icon: Users,
      detail: aiVoice ? ((memberCount ?? 0) === 0 ? "No aplica · campaña solo IA" : "Retira los ejecutivos asignados") : (memberCount ?? 0) > 0 ? `${memberCount} asignados` : "Asigna al menos un ejecutivo",
      done: aiVoice ? (memberCount ?? 0) === 0 : (memberCount ?? 0) > 0,
      href: aiVoice ? `${base}/ia` : `${base}/ejecutivos`,
    },
    {
      label: "Base de registros",
      icon: Database,
      detail:
        (leadCount ?? 0) > 0
          ? `${(leadCount ?? 0).toLocaleString("es-CL")} registros`
          : "Carga la base de la campaña",
      done: (leadCount ?? 0) > 0,
      href: `${base}/base`,
    },
    {
      label: "Discador",
      icon: PhoneCall,
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
  const doneCount = setupItems.length - pending;

  return (
    <div className="space-y-5">
      {/* Preparación como lista de pasos (Linear, Stripe): cada fila dice qué
          falta y lleva a donde se resuelve; la barra muestra cuánto queda. */}
      <SectionCard
        title="Preparación de la campaña"
        description="Estos cuatro puntos definen si la campaña puede operar."
        actions={
          <Badge tone={pending === 0 ? "success" : "warning"}>
            {pending === 0 ? "Lista para operar" : `${pending} pendiente${pending === 1 ? "" : "s"}`}
          </Badge>
        }
      >
        <div className="flex items-center gap-3 px-5 pb-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div
              className={`h-full rounded-full ${pending === 0 ? "bg-success" : "bg-primary"}`}
              style={{ width: `${Math.round((doneCount / setupItems.length) * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {doneCount} de {setupItems.length} listos
          </span>
        </div>
        <ul className="divide-y divide-border/70 border-t border-border">
          {setupItems.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                className="group flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted/55"
              >
                <span className="icon-chip size-8 rounded-lg" data-tone={item.done ? "green" : "amber"} aria-hidden="true">
                  {item.done ? <CheckCircle2 size={15} /> : <item.icon size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Listo" : "Pendiente"}</Badge>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Ajustes de la campaña"
        description="El guion que siguen los ejecutivos y el vocabulario con que se mide."
        actions={
          <Link
            href={`/dashboard/calidad/loop?campaign=${id}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
          >
            <Sparkles size={14} aria-hidden="true" />
            Loop IA · observación
          </Link>
        }
      >
        <div className="divide-y divide-border border-t border-border">
          {/* El ancla #flujo (tarjeta de preparación e Inicio) va pegada al
              grupo del flujo; antes caía sobre «Vertical de negocio». */}
          {!aiVoice && (
            <div id="flujo" className="scroll-mt-4">
              <Grupo
                titulo="Flujo de gestión"
                descripcion="Es el guion que los ejecutivos siguen al atender los registros de esta campaña."
                columnas={1}
              >
                <ActionForm action={setCampaignWorkflow} success="Flujo asignado" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="campaign_id" value={id} />
                  <Field label="Flujo asignado" className="w-full max-w-72">
                    <Select name="workflow_id" defaultValue={campaign.workflow_id ?? ""}>
                      <option value="">Sin flujo asignado</option>
                      {(workflows ?? []).map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <ActionSubmit variant="secondary" pendingLabel="Guardando…">
                    Guardar
                  </ActionSubmit>
                  <Link
                    href={`/dashboard/admin/flujos?campaign_id=${id}`}
                    className="pb-2 text-xs font-medium text-primary hover:underline"
                  >
                    Editar o crear un flujo
                  </Link>
                </ActionForm>
              </Grupo>
            </div>
          )}

          <Grupo
            titulo="Vertical de negocio"
            descripcion="Define el vocabulario y los KPI de la campaña: una cartera de cobranza mide recuperación, no ventas."
            columnas={1}
          >
            <ActionForm action={setCampaignVertical} success="Vertical actualizado" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="campaign_id" value={id} />
              <Field label="Vertical" className="w-full max-w-72">
                <Select name="vertical" defaultValue={campaignVertical}>
                  {CAMPAIGN_VERTICALS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <ActionSubmit variant="secondary" pendingLabel="Guardando…">
                Guardar
              </ActionSubmit>
            </ActionForm>
            <p className="text-xs text-muted-foreground">
              {CAMPAIGN_VERTICALS.find((option) => option.value === campaignVertical)?.description}
            </p>
          </Grupo>
        </div>
      </SectionCard>

      <SectionCard
        title="Atlas Lead"
        description="Conecta campañas de correo existentes con esta campaña CRM mediante su clave estable. Atlas Lead conserva el envío y tracking; Atlas CRM conserva la asignación y gestión."
        actions={
          (mailCampaigns ?? []).length > 0 ? (
            <Link href={`/dashboard/mail?campaign=${id}`} className="text-[13px] font-medium text-primary hover:underline">
              Abrir señales de correo
            </Link>
          ) : undefined
        }
      >
        {(mailCampaigns ?? []).length > 0 && (
          <ul className="divide-y divide-border/70 border-t border-border">
            {(mailCampaigns ?? []).map((mailCampaign) => (
              <li key={mailCampaign.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={mailCampaign.name} icon={Mail} size="md" shape="square" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{mailCampaign.name}</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{mailCampaign.external_campaign_key}</p>
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
          className="divide-y divide-border border-t border-border"
        >
          <input type="hidden" name="campaign_id" value={id} />
          <Grupo
            titulo="Vincular un envío"
            descripcion="No crea una campaña CRM nueva ni envía correos. El equipo elegido recibe los contactos nuevos y la exportación queda lista después de la confirmación segura de Atlas Lead."
          >
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
          </Grupo>
          <PieDeFormulario>
            <ActionSubmit disabled={routingTeams.length === 0} pendingLabel="Conectando…">Registrar y habilitar</ActionSubmit>
          </PieDeFormulario>
        </ActionForm>
      </SectionCard>

      {summaryError ? (
        <Callout tone="danger">
          No se pudieron calcular los indicadores de la campaña. La configuración de arriba sigue disponible;
          actualiza la página en unos minutos y, si sigue igual, avisa a soporte.
        </Callout>
      ) : (
        <CampaignDashboardSummary
          summary={summary as CampaignDashboardSummaryData}
          hourly={(hourly ?? []) as ContactabilityHour[]}
          vertical={campaignVertical}
          channelFunnel={
            isSecretariaVirtualAuditCampaign(campaign.name)
              ? ((channelFunnel ?? []) as SecretariaVirtualChannelFunnelRow[])
              : undefined
          }
        />
      )}
    </div>
  );
}
