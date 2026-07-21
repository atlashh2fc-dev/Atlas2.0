"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Layers } from "lucide-react";
import { CAMPAIGN_SCOPE_COOKIE } from "@/lib/campaign-scope-shared";

type CampaignOption = { id: string; name: string };

export function CampaignScopeSwitcher({
  campaigns,
  selectedCampaignId,
  role,
}: {
  campaigns: CampaignOption[];
  selectedCampaignId: string | null;
  role: "agente" | "supervisor" | "admin";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const supportedRoutes = role === "admin"
    ? ["/dashboard/reportes", "/dashboard/leads", "/dashboard/agenda"]
    : ["/dashboard/leads", "/dashboard/agenda", "/dashboard/team"];
  const supportsScope = supportedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (!supportsScope) return null;

  function changeScope(campaignId: string) {
    if (campaignId) {
      document.cookie = `${CAMPAIGN_SCOPE_COOKIE}=${encodeURIComponent(campaignId)}; Path=/; Max-Age=2592000; SameSite=Lax`;
    } else {
      document.cookie = `${CAMPAIGN_SCOPE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    }

    const params = new URLSearchParams(searchParams.toString());
    if (campaignId) params.set("campaign", campaignId);
    else params.delete("campaign");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="hidden items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground lg:flex">
      <Layers size={14} aria-hidden="true" />
      <span className="sr-only">Contexto de campaña</span>
      <select
        aria-label="Contexto de campaña"
        value={selectedCampaignId ?? ""}
        onChange={(event) => changeScope(event.target.value)}
        className="max-w-48 bg-transparent font-medium text-foreground outline-none"
      >
        <option value="">Todas las campañas</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </select>
    </label>
  );
}
