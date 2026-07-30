import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toggleCampaignActive } from "@/app/actions/campaigns";
import { setDialerCampaignActive } from "@/app/actions/dialer-config";
import { DIAL_MODES, type DialMode } from "@/lib/types";
import Link from "next/link";
import { Play, Settings2, Square } from "lucide-react";
import { CampaignCreatePanel } from "@/components/campaign-create-panel";
import {
  Badge,
  Button,
  Callout,
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

  const list = campaigns ?? [];

  // Conteos por campaña con `head: true`: antes esta pantalla se traía el
  // campaign_id de todos los leads de la base para contarlos en memoria.
  const [counts, dialerConfigs, memberRows] = await Promise.all([
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
    supabase.from("campaign_agents").select("campaign_id"),
  ]);

  const countById = new Map(counts.map((row) => [row.id, row]));
  const dialerByCampaign = new Map((dialerConfigs.data ?? []).map((config) => [config.campaign_id, config]));
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
          No se pudieron cargar las campañas: {campaignsError.message}
        </Callout>
      )}

      <SectionCard>
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
                Todavía no hay campañas. Crea la primera con el botón &ldquo;Nueva campaña&rdquo;.
              </TableEmpty>
            )}
            {list.map((campaign) => {
              const dialer = dialerByCampaign.get(campaign.id);
              const usesSiptel = dialer?.trunk_context === "siptel";
              const dialModeLabel = dialer
                ? DIAL_MODES.find((mode) => mode.value === (dialer.dial_mode as DialMode))?.label
                : null;
              const numbers = countById.get(campaign.id);
              const agentCount = agentsByCampaign.get(campaign.id) ?? 0;

              return (
                <Tr key={campaign.id}>
                  <Td strong>
                    <Link href={`/dashboard/admin/campanas/${campaign.id}`} className="hover:text-primary">
                      {campaign.name}
                    </Link>
                    {campaign.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{campaign.description}</p>
                    )}
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
                    {agentCount === 0 ? <span className="text-warning">0</span> : agentCount}
                  </Td>
                  <Td>
                    <Badge tone={campaign.is_active ? "success" : "danger"}>
                      {campaign.is_active ? "Activa" : "Inactiva"}
                    </Badge>
                  </Td>
                  <Td>
                    {dialer ? (
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
                    <div className="flex items-center justify-end gap-2">
                      {dialer && usesSiptel ? (
                        <form action={setDialerCampaignActive}>
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="desired_active" value={String(!dialer.is_active)} />
                          <Button
                            type="submit"
                            variant={dialer.is_active ? "danger" : "primary"}
                            size="sm"
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
                          </Button>
                        </form>
                      ) : (
                        <Link
                          href={`/dashboard/admin/campanas/${campaign.id}/discado`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          {dialer ? "Revisar ruta" : "Configurar"}
                        </Link>
                      )}
                      <form action={toggleCampaignActive}>
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="active" value={String(campaign.is_active)} />
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          title="Habilita o deshabilita la campaña completa"
                        >
                          {campaign.is_active ? "Deshabilitar" : "Habilitar"}
                        </Button>
                      </form>
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
