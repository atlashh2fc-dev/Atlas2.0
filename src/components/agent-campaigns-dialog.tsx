"use client";

import { useRef } from "react";
import { Megaphone } from "lucide-react";
import { UserCampaignsForm } from "@/components/user-campaigns-form";
import { Button } from "@/components/ui";

type CampaignOption = { id: string; name: string };

export function AgentCampaignsDialog({
  agent,
  campaignIds,
  campaigns,
}: {
  agent: { id: string; fullName: string; email: string };
  campaignIds: string[];
  campaigns: CampaignOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" size="sm" onClick={() => dialogRef.current?.showModal()}>
        Asignar campañas
      </Button>
      <dialog
        ref={dialogRef}
        className="w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface-solid p-0 text-foreground shadow-2xl backdrop:bg-black/45"
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="icon-chip mt-0.5 size-9 rounded-lg" data-tone="rose" aria-hidden="true">
            <Megaphone size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Campañas del ejecutivo</p>
            <h2 className="mt-1 text-lg font-semibold">{agent.fullName}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{agent.email}</p>
          </div>
        </div>
        <div className="p-5">
          <UserCampaignsForm userId={agent.id} campaignIds={campaignIds} campaigns={campaigns} />
        </div>
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.close()}>
            Cerrar
          </Button>
        </div>
      </dialog>
    </>
  );
}
