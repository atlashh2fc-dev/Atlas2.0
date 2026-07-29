"use client";

import { useState, useTransition } from "react";
import { setAgentCampaigns } from "@/app/actions/campaign-assignments";
import { Button } from "@/components/ui";

type CampaignOption = { id: string; name: string };

export function UserCampaignsForm({
  userId,
  campaignIds,
  campaigns,
}: {
  userId: string;
  campaignIds: string[];
  campaigns: CampaignOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedCampaignIds, setSelectedCampaignIds] = useState(() => new Set(campaignIds));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await setAgentCampaigns(formData);
        setMessage("Guardado");
        window.location.reload();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudieron guardar las campañas.");
      }
    });
  }

  return (
    <form action={save} className="space-y-2">
      <input type="hidden" name="profile_id" value={userId} />
      <div>
        <p className="text-xs font-medium text-foreground">Campañas / skills</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Selecciona todas las campañas que puede operar.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {campaigns.map((campaign) => {
          const selected = selectedCampaignIds.has(campaign.id);
          return (
            <label
              key={campaign.id}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:border-primary/50"
              }`}
            >
              <input
                type="checkbox"
                name="campaign_ids"
                value={campaign.id}
                defaultChecked={selected}
                disabled={isPending}
                onChange={(event) => {
                  setSelectedCampaignIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(campaign.id);
                    else next.delete(campaign.id);
                    return next;
                  });
                }}
                className="size-3.5 accent-primary"
              />
              {campaign.name}
            </label>
          );
        })}
        {campaigns.length === 0 && <span className="text-xs text-muted-foreground">No hay campañas activas.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar campañas"}
        </Button>
        <span aria-live="polite" className="text-[11px] leading-4">
          {message && <span className="text-success">{message}</span>}
          {error && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </form>
  );
}
