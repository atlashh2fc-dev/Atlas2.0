import "server-only";

import { enableAtlasLeadCampaignExport, reconcileAtlasLeadCampaignHistory } from "./atlas-lead-exportacion.server";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

/*
 * Vínculo entre una campaña de correo (vive en Atlas Lead) y la campaña del CRM
 * donde se gestionan quienes la abren, hacen clic o responden.
 *
 * Sin este vínculo Atlas Lead no exporta ningún evento: la campaña sale, mide
 * aperturas en su pantalla, pero nadie aparece en Correo ni se puede asignar.
 * Pasó con «Altius · Atlas CRM Vet» y con las cuatro «Campaña_SV_…_Octubre» de
 * Geimser (15-10-2026), creadas desde el CRM sin que nada las conectara.
 */

export type VinculoCorreoCrm = {
  mailCampaignId: string;
  campaignId: string;
  campaignName: string;
  equipo: string | null;
  listo: boolean;
};

export type OpcionCampanaCrm = { id: string; nombre: string; equipos: { id: string; nombre: string }[] };

export type OpcionesDeVinculo = {
  campanas: OpcionCampanaCrm[];
  /** La campaña y el equipo de la última campaña de correo conectada de la empresa. */
  sugerencia: { campaignId: string; teamId: string } | null;
};

type MailCampaignFila = {
  id: string;
  campaign_id: string;
  metadata: Record<string, unknown> | null;
  campaigns: { name: string; organization_id: string } | { name: string; organization_id: string }[] | null;
};

function uno<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

export async function vinculoDeCampanaDeCorreo(campanaId: string): Promise<VinculoCorreoCrm | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mail_campaigns")
    .select("id, campaign_id, metadata, campaigns(name, organization_id)")
    .eq("external_campaign_key", campanaId)
    .maybeSingle();
  const fila = data as MailCampaignFila | null;
  if (!fila) return null;
  const equipoId = typeof fila.metadata?.routing_team_id === "string" ? fila.metadata.routing_team_id : null;
  const { data: equipo } = equipoId ? await supabase.from("teams").select("name").eq("id", equipoId).maybeSingle() : { data: null };
  return {
    mailCampaignId: fila.id,
    campaignId: fila.campaign_id,
    campaignName: uno(fila.campaigns)?.name ?? "Campaña del CRM",
    equipo: (equipo?.name as string | undefined) ?? null,
    listo: fila.metadata?.readiness === "ready",
  };
}

/**
 * Campañas del CRM de la empresa que pueden recibir los leads del correo: las
 * activas con ejecutivos habilitados, y por cada una los equipos de esos
 * ejecutivos (el reparto exige un equipo con gente en la campaña).
 */
export async function opcionesDeVinculo(organizacionId: string): Promise<OpcionesDeVinculo> {
  const supabase = await createClient();
  const [{ data: campanas }, { data: conectadas }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, campaign_agents(profiles(team_id, role, active, teams(id, name)))")
      .eq("organization_id", organizacionId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("mail_campaigns")
      .select("campaign_id, metadata, updated_at, campaigns!inner(organization_id)")
      .eq("campaigns.organization_id", organizacionId)
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  type Perfil = { team_id: string | null; role: string; active: boolean; teams: { id: string; name: string } | { id: string; name: string }[] | null };
  const opciones: OpcionCampanaCrm[] = [];
  for (const campana of (campanas ?? []) as unknown as Array<{ id: string; name: string; campaign_agents: Array<{ profiles: Perfil | Perfil[] | null }> }>) {
    const equipos = new Map<string, string>();
    for (const miembro of campana.campaign_agents ?? []) {
      const perfil = uno(miembro.profiles);
      const equipo = uno(perfil?.teams ?? null);
      if (perfil?.active && perfil.role === "agente" && equipo) equipos.set(equipo.id, equipo.name);
    }
    if (equipos.size) {
      opciones.push({
        id: campana.id,
        nombre: campana.name,
        equipos: [...equipos].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      });
    }
  }

  let sugerencia: OpcionesDeVinculo["sugerencia"] = null;
  for (const fila of (conectadas ?? []) as Array<{ campaign_id: string; metadata: Record<string, unknown> | null }>) {
    const teamId = typeof fila.metadata?.routing_team_id === "string" ? fila.metadata.routing_team_id : null;
    const opcion = opciones.find((item) => item.id === fila.campaign_id);
    if (teamId && opcion?.equipos.some((equipo) => equipo.id === teamId)) {
      sugerencia = { campaignId: fila.campaign_id, teamId };
      break;
    }
  }
  if (!sugerencia && opciones.length === 1 && opciones[0].equipos.length === 1) {
    sugerencia = { campaignId: opciones[0].id, teamId: opciones[0].equipos[0].id };
  }
  return { campanas: opciones, sugerencia };
}

/**
 * Conecta la campaña de correo con la campaña del CRM: registra el vínculo,
 * enciende la exportación en Atlas Lead, reenvía lo que ya pasó (aperturas y
 * clics anteriores) y confirma. Reintentar es seguro: cada paso es idempotente.
 *
 * Quien llama ya comprobó el rol; acá se comprueba que la campaña y el equipo
 * sean de la empresa que se está mirando antes de escribir con service_role.
 */
export async function conectarCampanaDeCorreoAlCrm(input: {
  organizacionId: string;
  campanaCorreoId: string;
  nombre: string;
  campaignId: string;
  teamId: string;
  metadata?: Record<string, unknown>;
}): Promise<VinculoCorreoCrm> {
  const opciones = await opcionesDeVinculo(input.organizacionId);
  const opcion = opciones.campanas.find((item) => item.id === input.campaignId);
  if (!opcion) throw new Error("Esa campaña del CRM no es de esta empresa o no tiene ejecutivos habilitados.");
  if (!opcion.equipos.some((equipo) => equipo.id === input.teamId)) {
    throw new Error("Ese equipo no tiene ejecutivos activos en la campaña elegida.");
  }

  const admin = createAdminClient();
  const { data: mapeo, error: errorMapeo } = await admin.rpc("map_atlas_lead_mail_campaign_sin_empresa", {
    p_external_campaign_key: input.campanaCorreoId,
    p_campaign_id: input.campaignId,
    p_name: input.nombre.slice(0, 300),
    p_status: "active",
    p_metadata: {
      ...input.metadata,
      mapped_from: "campanas_correo",
      source_project: "atlas-lead-engine",
      source_campaign_id: input.campanaCorreoId,
      routing_team_id: input.teamId,
    },
  });
  if (errorMapeo) {
    throw new Error(
      errorMapeo.message.includes("ya está mapeada")
        ? "Esta campaña de correo ya está conectada a otra campaña del CRM."
        : `No se pudo registrar el vínculo: ${errorMapeo.message}`,
    );
  }
  if (!(mapeo as { mapped?: boolean } | null)?.mapped) throw new Error("El CRM no pudo registrar el vínculo.");

  const habilitada = await enableAtlasLeadCampaignExport(input.campanaCorreoId, input.campaignId);
  const historia = await reconcileAtlasLeadCampaignHistory(input.campanaCorreoId);
  const { error: errorConfirmacion } = await admin.rpc("confirm_atlas_lead_mail_campaign_handshake_sin_empresa", {
    p_external_campaign_key: input.campanaCorreoId,
    p_campaign_id: input.campaignId,
    p_readiness_metadata: {
      acknowledged: habilitada.acknowledged === true,
      ready: habilitada.ready === true,
      confirmed_via: "campanas_correo",
      history_outbox_complete: historia.complete === true,
      history_batches: Number(historia.batchesRun ?? 0),
      history_messages_scanned: Number(historia.messagesScanned ?? 0),
      history_events_planned: Number(historia.eventsPlanned ?? 0),
      history_deliveries_enqueued: Number(historia.deliveriesEnqueued ?? 0),
    },
  });
  if (errorConfirmacion) throw new Error("Atlas Lead quedó exportando, pero el CRM no cerró el vínculo. Reintenta.");

  const vinculo = await vinculoDeCampanaDeCorreo(input.campanaCorreoId);
  if (!vinculo) throw new Error("El vínculo quedó registrado, pero no se pudo leer. Recarga la página.");
  return vinculo;
}
