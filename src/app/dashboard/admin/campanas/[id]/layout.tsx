import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { Bot, Play, Square } from "lucide-react";
import { toggleCampaignActive } from "@/app/actions/campaigns";
import { setDialerCampaignActive } from "@/app/actions/dialer-config";
import { DIAL_MODES, type AiVoiceCampaignConfig, type DialerCampaignConfig } from "@/lib/types";
import { ActionForm, ActionSubmit, Badge, NavTabs } from "@/components/ui";
import { CabeceraDeEntidad, Migas } from "../../_diseno";

/**
 * Detalle de campaña en pestañas. Antes era una sola página de 500 líneas con
 * preparación, ejecutivos, horarios y discado apilados
 * (docs/auditoria-vistas-workplace.md §4.10).
 */
export default async function CampaignDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: campaign }, { data: dialerConfig }, { data: aiConfig }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("ai_voice_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
  ]);
  if (!campaign) notFound();

  const dialer = dialerConfig as DialerCampaignConfig | null;
  const aiVoice = aiConfig as AiVoiceCampaignConfig | null;
  const usesSiptel = dialer?.trunk_context === "siptel";
  const base = `/dashboard/admin/campanas/${id}`;

  return (
    <div className="space-y-5">
      <Migas items={[{ label: "Campañas", href: "/dashboard/admin/campanas" }, { label: campaign.name }]} />

      <CabeceraDeEntidad
        nombre={campaign.name}
        icon={aiVoice ? Bot : undefined}
        apagada={!campaign.is_active}
        descripcion={campaign.description ?? undefined}
        meta={
          <>
            <Badge tone={campaign.is_active ? "success" : "neutral"}>
              {campaign.is_active ? "Campaña activa" : "Campaña inactiva"}
            </Badge>
            {aiVoice ? (
              <Badge tone={aiVoice.is_active ? "success" : "neutral"}>
                {aiVoice.is_active ? "IA en ejecución" : "IA detenida"}
              </Badge>
            ) : dialer ? (
              <Badge tone={!usesSiptel ? "warning" : dialer.is_active ? "success" : "neutral"}>
                {!usesSiptel
                  ? "Ruta por revisar"
                  : `${dialer.is_active ? "Discando" : "Discador detenido"} · ${
                      DIAL_MODES.find((mode) => mode.value === dialer.dial_mode)?.label ?? dialer.dial_mode
                    }`}
              </Badge>
            ) : (
              <Badge>Discador sin configurar</Badge>
            )}
          </>
        }
        acciones={
          <>
            {dialer && !aiVoice && usesSiptel && (
              <ActionForm
                action={setDialerCampaignActive}
                success={dialer.is_active ? "Discado detenido" : "Discado iniciado"}
                confirm={
                  dialer.is_active
                    ? {
                        title: "¿Detener el discado de esta campaña?",
                        description:
                          "El discador deja de marcar nuevos números. Las llamadas ya conectadas siguen hasta que terminen. Puedes iniciarlo otra vez cuando quieras.",
                        confirmLabel: "Detener discado",
                        tone: "danger",
                      }
                    : undefined
                }
              >
                <input type="hidden" name="campaign_id" value={id} />
                <input type="hidden" name="desired_active" value={String(!dialer.is_active)} />
                {/* Secundario: el primario de la vista es el «Guardar» de cada pestaña. */}
                <ActionSubmit
                  variant="secondary"
                  pendingLabel={dialer.is_active ? "Deteniendo…" : "Iniciando…"}
                  title={
                    dialer.is_active
                      ? "Detener nuevas marcaciones; no corta llamadas conectadas"
                      : "Iniciar las marcaciones automáticas de esta campaña"
                  }
                >
                  {dialer.is_active ? (
                    <Square className="h-3 w-3 text-danger" fill="currentColor" />
                  ) : (
                    <Play className="h-3 w-3 text-success" fill="currentColor" />
                  )}
                  {dialer.is_active ? "Detener discado" : "Iniciar discado"}
                </ActionSubmit>
              </ActionForm>
            )}

            {/* Apagar la campaña completa va aparte del discador y pide confirmar. */}
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
              <input type="hidden" name="campaign_id" value={id} />
              <input type="hidden" name="active" value={String(campaign.is_active)} />
              <ActionSubmit variant="ghost" pendingLabel="Guardando…">
                {campaign.is_active ? "Deshabilitar" : "Habilitar"}
              </ActionSubmit>
            </ActionForm>
          </>
        }
      />

      <NavTabs
        tabs={
          aiVoice
            ? [
                { label: "Resumen", href: base },
                { label: "Base", href: `${base}/base` },
                { label: "Agente IA", href: `${base}/ia` },
              ]
            : [
                { label: "Resumen", href: base },
                { label: "Base", href: `${base}/base` },
                { label: "Ejecutivos", href: `${base}/ejecutivos` },
                { label: "Priorización", href: `${base}/priorizacion` },
                { label: "Discado", href: `${base}/discado` },
              ]
        }
      />

      {children}
    </div>
  );
}
