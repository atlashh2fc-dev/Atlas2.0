import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toggleCampaignActive } from "@/app/actions/campaigns";
import { setDialerCampaignActive } from "@/app/actions/dialer-config";
import { DIAL_MODES, type DialMode } from "@/lib/types";
import { CAMPAIGN_VERTICALS, parseCampaignVertical } from "@/lib/campaign-vertical";
import Link from "next/link";
import { Bot, Megaphone, Play, Settings2, Square } from "lucide-react";
import { CampaignCreatePanel } from "@/components/campaign-create-panel";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  EmptyState,
  InfoTooltip,
  PageHeader,
  SectionCard,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TableEmpty,
  Tr,
  buttonClasses,
} from "@/components/ui";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireProfile(["admin"]);
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select("*, workflows(name)")
    .order("created_at", { ascending: true });

  if (campaignsError) console.error("[admin/campanas] carga de campañas", campaignsError);
  const list = campaigns ?? [];

  // Conteos por campaña con `head: true`: antes esta pantalla se traía el
  // campaign_id de todos los leads de la base para contarlos en memoria.
  const [counts, dialerConfigs, aiVoiceConfigs, memberRows] = await Promise.all([
    Promise.all(
      list.map(async (campaign) => {
        const [{ count: total }, { count: pending }] = await Promise.all([
          supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id),
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaign.id)
            .is("managed_at", null),
        ]);
        return { id: campaign.id as string, total: total ?? 0, pending: pending ?? 0 };
      })
    ),
    supabase.from("dialer_campaign_configs").select("campaign_id, dial_mode, is_active, trunk_context"),
    supabase.from("ai_voice_campaign_configs").select("campaign_id, is_active, phone_number_id"),
    // Acotado a las campañas de la lista: sin filtro, pasado el tope de filas
    // de la API «sin ejecutivos» daría falsos positivos.
    list.length > 0
      ? supabase.from("campaign_agents").select("campaign_id").in("campaign_id", list.map((campaign) => campaign.id as string))
      : Promise.resolve({ data: [] as { campaign_id: string }[] }),
  ]);

  const countById = new Map(counts.map((row) => [row.id, row]));
  const dialerByCampaign = new Map((dialerConfigs.data ?? []).map((config) => [config.campaign_id, config]));
  const aiVoiceByCampaign = new Map((aiVoiceConfigs.data ?? []).map((config) => [config.campaign_id, config]));
  const agentsByCampaign = new Map<string, number>();
  for (const row of memberRows.data ?? []) {
    agentsByCampaign.set(row.campaign_id, (agentsByCampaign.get(row.campaign_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campañas"
        description="Cada campaña tiene su base, sus ejecutivos, su flujo de gestión y su configuración de discado."
        actions={<CampaignCreatePanel duplicateName={error === "duplicate-name"} />}
      />

      {campaignsError && (
        <Callout tone="danger">
          No se pudieron cargar las campañas. Actualiza la página en unos segundos; si sigue igual, avisa a soporte.
        </Callout>
      )}

      <SectionCard
        icon={Megaphone}
        tone="rose"
        title="Campañas"
        description={`${list.length.toLocaleString("es-CL")} ${list.length === 1 ? "campaña" : "campañas"} · base, ejecutivos y discador de cada una`}
      >
        <Table>
          <Thead>
            <Th>Nombre</Th>
            <Th>Flujo de gestión</Th>
            <Th align="right">Base</Th>
            <Th align="right">
              <span className="inline-flex items-center gap-1">
                Sin gestionar
                <InfoTooltip
                  text="Registros de la campaña que todavía no han tenido una gestión registrada."
                  align="right"
                />
              </span>
            </Th>
            <Th align="right">Ejecutivos</Th>
            <Th>Campaña</Th>
            <Th>Discador</Th>
            <Th />
          </Thead>
          <Tbody>
            {list.length === 0 && (
              <TableEmpty colSpan={8}>
                <EmptyState
                  icon={Megaphone}
                  title="Todavía no hay campañas"
                  description="Crea la primera con el botón “Nueva campaña”."
                  className="py-6"
                />
              </TableEmpty>
            )}
            {list.map((campaign) => {
              const dialer = dialerByCampaign.get(campaign.id);
              const aiVoice = aiVoiceByCampaign.get(campaign.id);
              const usesSiptel = dialer?.trunk_context === "siptel";
              const dialModeLabel = dialer
                ? DIAL_MODES.find((mode) => mode.value === (dialer.dial_mode as DialMode))?.label
                : null;
              const numbers = countById.get(campaign.id);
              const agentCount = agentsByCampaign.get(campaign.id) ?? 0;

              return (
                <Tr key={campaign.id}>
                  <Td strong>
                    <div className="flex items-start gap-3">
                      <span
                        className={`icon-chip mt-0.5 size-8 rounded-lg ${campaign.is_active ? "" : "opacity-50"}`}
                        data-tone={aiVoice ? "violet" : "rose"}
                        aria-hidden="true"
                      >
                        {aiVoice ? <Bot size={15} /> : <Megaphone size={15} />}
                      </span>
                      <div className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/admin/campanas/${campaign.id}`} className="hover:text-primary">
                            {campaign.name}
                          </Link>
                          {parseCampaignVertical(campaign.vertical) === "cobranza" && (
                            <Badge tone="info">
                              {CAMPAIGN_VERTICALS.find((option) => option.value === "cobranza")?.label}
                            </Badge>
                          )}
                        </span>
                        {campaign.description && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{campaign.description}</p>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td muted>
                    {(campaign.workflows as { name: string } | null)?.name ?? (
                      <span className="text-warning">Sin flujo</span>
                    )}
                  </Td>
                  <Td align="right" muted>
                    {(numbers?.total ?? 0).toLocaleString("es-CL")}
                  </Td>
                  <Td align="right" muted>
                    {(numbers?.pending ?? 0).toLocaleString("es-CL")}
                  </Td>
                  <Td align="right">
                    {aiVoice ? <span className="text-muted-foreground">No aplica</span> : agentCount === 0 ? <span className="text-warning">0</span> : agentCount}
                  </Td>
                  <Td>
                    <Badge tone={campaign.is_active ? "success" : "danger"}>
                      {campaign.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                  </Td>
                  <Td>
                    {aiVoice ? (
                      <div className="space-y-1">
                        <Badge tone={aiVoice.is_active ? "success" : "danger"}>
                          {aiVoice.is_active ? "IA en ejecución" : "IA detenida"}
                        </Badge>
                        <p className="text-xs text-muted-foreground">ElevenLabs · sin ejecutivos</p>
                      </div>
                    ) : dialer ? (
                      <div className="space-y-1">
                        <Badge tone={!usesSiptel ? "warning" : dialer.is_active ? "success" : "danger"}>
                          {!usesSiptel ? "Ruta por revisar" : dialer.is_active ? "En ejecución" : "Detenido"}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{dialModeLabel ?? dialer.dial_mode}</p>
                      </div>
                    ) : (
                      <Badge>Sin configurar</Badge>
                    )}
                  </Td>
                  <Td align="right">
                    {/* Operar el discador y apagar la campaña completa son
                        decisiones distintas: van separadas y la segunda pide
                        confirmar, porque saca la campaña de Reportes. */}
                    <div className="flex items-center justify-end gap-4">
                      {aiVoice ? (
                        <Link
                          href={`/dashboard/admin/campanas/${campaign.id}/ia`}
                          className={buttonClasses({ variant: "secondary", size: "sm" })}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          Configurar IA
                        </Link>
                      ) : dialer && usesSiptel ? (
                        <ActionForm
                          action={setDialerCampaignActive}
                          success={dialer.is_active ? "Discado detenido" : "Discado iniciado"}
                          confirm={
                            dialer.is_active
                              ? {
                                  title: `¿Detener el discado de ${campaign.name}?`,
                                  description:
                                    "El discador deja de marcar nuevos números. Las llamadas ya conectadas siguen hasta que terminen. Puedes iniciarlo otra vez cuando quieras.",
                                  confirmLabel: "Detener discado",
                                  tone: "danger",
                                }
                              : undefined
                          }
                        >
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="desired_active" value={String(!dialer.is_active)} />
                          <ActionSubmit
                            variant={dialer.is_active ? "danger" : "secondary"}
                            size="sm"
                            pendingLabel="…"
                            title={
                              dialer.is_active
                                ? "Detener nuevas marcaciones; no corta llamadas conectadas"
                                : "Iniciar las marcaciones automáticas de esta campaña"
                            }
                          >
                            {dialer.is_active ? (
                              <Square className="h-3.5 w-3.5" fill="currentColor" />
                            ) : (
                              <Play className="h-3.5 w-3.5" fill="currentColor" />
                            )}
                            {dialer.is_active ? "Detener" : "Iniciar"}
                          </ActionSubmit>
                        </ActionForm>
                      ) : (
                        <Link
                          href={`/dashboard/admin/campanas/${campaign.id}/discado`}
                          className={buttonClasses({ variant: "secondary", size: "sm" })}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          {dialer ? "Revisar ruta" : "Configurar"}
                        </Link>
                      )}
                      <ActionForm
                        action={toggleCampaignActive}
                        success={campaign.is_active ? "Campaña deshabilitada" : "Campaña habilitada"}
                        confirm={
                          campaign.is_active
                            ? {
                                title: `¿Deshabilitar ${campaign.name}?`,
                                description:
                                  "La campaña sale de Reportes y del alcance de supervisión: su historial deja de verse hasta que la vuelvas a habilitar.",
                                confirmLabel: "Deshabilitar campaña",
                                tone: "danger",
                              }
                            : undefined
                        }
                      >
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="active" value={String(campaign.is_active)} />
                        <ActionSubmit
                          variant="ghost"
                          size="sm"
                          pendingLabel="…"
                          title="Habilita o deshabilita la campaña completa"
                        >
                          {campaign.is_active ? "Deshabilitar" : "Habilitar"}
                        </ActionSubmit>
                      </ActionForm>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
