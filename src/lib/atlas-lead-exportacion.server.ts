import "server-only";

/*
 * Exportación de eventos de una campaña de Atlas Lead al CRM.
 *
 * Atlas Lead solo exporta aperturas, clics y respuestas de una campaña que
 * tiene habilitada la exportación con su campaña del CRM; la historia previa
 * se reenvía con la reconciliación. La usan el vínculo manual de
 * Administración y el automático de Campañas de correo.
 */

function atlasLeadIntegrationEndpoint(pathname: string): { url: URL; secret: string } {
  const baseUrl = process.env.ATLAS_LEAD_INTEGRATION_URL?.trim();
  const secret = process.env.INTEGRATION_DISPATCH_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero falta configurar la conexión segura con Atlas Lead. No se habilitó la exportación.",
    );
  }

  let url: URL;
  try {
    url = new URL(pathname, baseUrl);
  } catch {
    throw new Error("La URL de integración de Atlas Lead no es válida.");
  }
  const localDevelopment = process.env.NODE_ENV !== "production"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("La conexión con Atlas Lead debe usar HTTPS.");
  }
  if (secret.length < 32) {
    throw new Error("La conexión segura con Atlas Lead no está configurada correctamente.");
  }
  return { url, secret };
}

export async function enableAtlasLeadCampaignExport(externalCampaignKey: string, campaignId: string) {
  const { url, secret } = atlasLeadIntegrationEndpoint("/api/integrations/outbox/campaign-readiness");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        campaignId: externalCampaignKey,
        crmCampaignId: campaignId,
        enabled: true,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero Atlas Lead no respondió. La exportación permanece pendiente.",
    );
  }

  const payload = await response.json().catch(() => null) as { acknowledged?: boolean; ready?: boolean } | null;
  if (!response.ok || payload?.acknowledged !== true || payload.ready !== true) {
    throw new Error(
      "El vínculo quedó registrado en CRM, pero Atlas Lead no confirmó la habilitación. La exportación permanece pendiente.",
    );
  }
  return payload;
}

export type AtlasLeadBackfillAck = {
  acknowledged?: boolean;
  complete?: boolean;
  hasMore?: boolean;
  batchesRun?: number;
  messagesScanned?: number;
  eventsPlanned?: number;
  deliveriesEnqueued?: number;
  remainingEvents?: number;
  remainingDeliveries?: number;
};

export async function reconcileAtlasLeadCampaignHistory(externalCampaignKey: string): Promise<AtlasLeadBackfillAck> {
  const { url, secret } = atlasLeadIntegrationEndpoint("/api/integrations/outbox/backfill");
  url.searchParams.set("campaignId", externalCampaignKey);
  url.searchParams.set("dryRun", "false");
  url.searchParams.set("drain", "true");
  url.searchParams.set("limit", "5000");
  url.searchParams.set("maxBatches", "20");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new Error(
      "Atlas Lead quedó habilitado, pero la reconciliación histórica no respondió. Reintenta para continuar desde el último evento pendiente.",
    );
  }

  const payload = await response.json().catch(() => null) as AtlasLeadBackfillAck | null;
  if (!response.ok || payload?.acknowledged !== true) {
    throw new Error(
      "Atlas Lead quedó habilitado, pero no aceptó la reconciliación histórica. Reintenta para completar el vínculo.",
    );
  }
  if (payload.complete !== true || payload.hasMore === true) {
    throw new Error(
      "La reconciliación histórica avanzó, pero aún quedan eventos pendientes. Reintenta para continuar sin duplicar registros.",
    );
  }
  return payload;
}
