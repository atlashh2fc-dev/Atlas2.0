"use client";

import { useRef } from "react";
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
        className="w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/45"
      >
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campañas del ejecutivo</p>
          <h2 className="mt-1 text-lg font-semibold">{agent.fullName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{agent.email}</p>
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
