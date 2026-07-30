import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Play, Square } from "lucide-react";
import { toggleCampaignActive } from "@/app/actions/campaigns";
import { setDialerCampaignActive } from "@/app/actions/dialer-config";
import type { DialerCampaignConfig } from "@/lib/types";
import { ActionForm, ActionSubmit, Badge, NavTabs, PageHeader } from "@/components/ui";

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

  const [{ data: campaign }, { data: dialerConfig }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
  ]);
  if (!campaign) notFound();

  const dialer = dialerConfig as DialerCampaignConfig | null;
  const usesSiptel = dialer?.trunk_context === "siptel";
  const base = `/dashboard/admin/campanas/${id}`;

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/admin/campanas"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={13} />
        Campañas
      </Link>

      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        className="border-b-0 pb-0"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={campaign.is_active ? "success" : "danger"}>
              {campaign.is_active ? "Campaña activa" : "Campaña inactiva"}
            </Badge>

            {dialer && usesSiptel && (
              <ActionForm
                action={setDialerCampaignActive}
                success={dialer.is_active ? "Discado detenido" : "Discado iniciado"}
              >
                <input type="hidden" name="campaign_id" value={id} />
                <input type="hidden" name="desired_active" value={String(!dialer.is_active)} />
                <ActionSubmit
                  variant={dialer.is_active ? "danger" : "primary"}
                  size="sm"
                  pendingLabel={dialer.is_active ? "Deteniendo…" : "Iniciando…"}
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
                  {dialer.is_active ? "Detener discado" : "Iniciar discado"}
                </ActionSubmit>
              </ActionForm>
            )}

            <ActionForm
              action={toggleCampaignActive}
              success={campaign.is_active ? "Campaña deshabilitada" : "Campaña habilitada"}
            >
              <input type="hidden" name="campaign_id" value={id} />
              <input type="hidden" name="active" value={String(campaign.is_active)} />
              <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                {campaign.is_active ? "Deshabilitar" : "Habilitar"}
              </ActionSubmit>
            </ActionForm>
          </div>
        }
      />

      <NavTabs
        tabs={[
          { label: "Resumen", href: base },
          { label: "Base", href: `${base}/base` },
          { label: "Ejecutivos", href: `${base}/ejecutivos` },
          { label: "Discado", href: `${base}/discado` },
        ]}
      />

      {children}
    </div>
  );
}
