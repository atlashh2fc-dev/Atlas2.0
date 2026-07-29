"use client";

import { useState, useTransition } from "react";
import { setAgentCampaigns } from "@/app/actions/campaign-assignments";
import { Button, Select } from "@/components/ui";

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
    <form action={save} className="flex items-start gap-2">
      <input type="hidden" name="profile_id" value={userId} />
      <Select
        name="campaign_ids"
        multiple
        size={Math.min(Math.max(campaigns.length, 2), 5)}
        defaultValue={campaignIds}
        disabled={isPending}
        aria-label="Campañas asignadas"
        className="min-w-44"
      >
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </Select>
      <div className="space-y-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        <span aria-live="polite" className="block max-w-44 text-[11px] leading-4">
          {message && <span className="text-success">{message}</span>}
          {error && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </form>
  );
}
