import { cookies } from "next/headers";
import { CAMPAIGN_SCOPE_COOKIE } from "@/lib/campaign-scope-shared";

export { CAMPAIGN_SCOPE_COOKIE };

/**
 * La campaña puede venir en la URL para que una vista sea compartible. Cuando
 * no viene, conserva el último contexto elegido por el usuario en el CRM.
 */
export async function resolveCampaignScope(requestedCampaignId?: string): Promise<string | null> {
  const requested = requestedCampaignId?.trim();
  if (requested) return requested;

  const value = (await cookies()).get(CAMPAIGN_SCOPE_COOKIE)?.value?.trim();
  return value || null;
}
