"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Lock, LockOpen } from "lucide-react";
import {
  assignAgentCampaign,
  releaseAgentCampaign,
  setAgentCampaignPriorities,
  type AgentCampaignBoardRow,
} from "@/app/actions/campaign-control";
import { Badge, Button, Select, Table, TableEmpty, Tbody, Td, Th, Thead, Tr, useToast } from "@/components/ui";

const TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
});

function currentLabel(row: AgentCampaignBoardRow, viewerId: string) {
  if (!row.active_campaign_id) return <Badge tone="warning">Sin campaña</Badge>;
  const since = row.changed_at ? ` · ${TIME_FORMAT.format(new Date(row.changed_at))}` : "";
  if (row.locked) {
    const who = row.assigned_by === viewerId ? "ti" : row.assigned_by_name ?? "otro supervisor";
    return (
      <span className="flex flex-col gap-1">
        <span className="font-medium">{row.active_campaign_name}</span>
        <Badge tone="info" className="w-fit gap-1">
          <Lock size={11} /> Fijada por {who}
          {since}
        </Badge>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">{row.active_campaign_name}</span>
      <Badge tone="neutral" className="w-fit">
        {row.source === "prioridad" ? "Por prioridad" : "Elegida por el ejecutivo"}
        {since}
      </Badge>
    </span>
  );
}

/**
 * Multiskill del equipo: en qué campaña está cada ejecutivo, el orden en que se
 * le prioriza y la asignación fija. Una campaña fijada solo la cambia quien la fijó.
 */
export function TeamCampaignControl({
  rows,
  viewerId,
  isAdmin,
}: {
  rows: AgentCampaignBoardRow[];
  viewerId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Record<string, string>>({});

  function run(action: () => Promise<void>, message: string) {
    startTransition(async () => {
      try {
        await action();
        toast({ tone: "success", message });
        router.refresh();
      } catch (error) {
        toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo guardar." });
      }
    });
  }

  function move(row: AgentCampaignBoardRow, index: number, delta: number) {
    const order = row.campaigns.map((campaign) => campaign.campaign_id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    run(() => setAgentCampaignPriorities(row.profile_id, order), `Prioridad de ${row.full_name} actualizada`);
  }

  if (rows.length === 0) {
    return (
      <Table>
        <Tbody>
          <TableEmpty colSpan={4}>No hay ejecutivos activos en tus equipos.</TableEmpty>
        </Tbody>
      </Table>
    );
  }

  return (
    <Table>
      <Thead>
        <Th>Ejecutivo</Th>
        <Th>Campaña activa</Th>
        <Th>Prioridad de discado</Th>
        <Th>Asignar</Th>
      </Thead>
      <Tbody>
        {rows.map((row) => {
          const lockedByOther = row.locked && row.assigned_by !== viewerId && !isAdmin;
          const selected = target[row.profile_id] ?? row.active_campaign_id ?? row.campaigns[0]?.campaign_id ?? "";
          return (
            <Tr key={row.profile_id}>
              <Td strong>
                <span className="flex flex-col">
                  {row.full_name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {[row.team_name, row.extension ? `Anexo ${row.extension}` : "Sin anexo"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Td>
              <Td>{currentLabel(row, viewerId)}</Td>
              <Td>
                {row.campaigns.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Sin campañas con discador</span>
                ) : (
                  <ol className="space-y-1">
                    {row.campaigns.map((campaign, index) => (
                      <li key={campaign.campaign_id} className="flex items-center gap-2 text-xs">
                        <span className="w-4 text-right font-semibold text-muted-foreground">{index + 1}.</span>
                        <span className="flex-1">{campaign.name}</span>
                        <button
                          type="button"
                          aria-label={`Subir prioridad de ${campaign.name}`}
                          disabled={pending || index === 0}
                          onClick={() => move(row, index, -1)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar prioridad de ${campaign.name}`}
                          disabled={pending || index === row.campaigns.length - 1}
                          onClick={() => move(row, index, 1)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </Td>
              <Td>
                {lockedByOther ? (
                  <span className="text-xs text-muted-foreground">
                    Solo {row.assigned_by_name ?? "quien la fijó"} o un admin puede cambiarla.
                  </span>
                ) : row.campaigns.length === 0 ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      fieldSize="sm"
                      value={selected}
                      disabled={pending}
                      onChange={(event) => setTarget((current) => ({ ...current, [row.profile_id]: event.target.value }))}
                      aria-label={`Campaña para ${row.full_name}`}
                      className="w-auto"
                    >
                      {row.campaigns.map((campaign) => (
                        <option key={campaign.campaign_id} value={campaign.campaign_id}>
                          {campaign.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={pending || !selected}
                      onClick={() =>
                        run(
                          () => assignAgentCampaign(row.profile_id, selected),
                          `${row.full_name} quedó fijo en ${row.campaigns.find((c) => c.campaign_id === selected)?.name ?? "la campaña"}`
                        )
                      }
                    >
                      <Lock size={13} /> Asignar y fijar
                    </Button>
                    {row.locked && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          run(() => releaseAgentCampaign(row.profile_id), `${row.full_name} puede volver a elegir campaña`)
                        }
                      >
                        <LockOpen size={13} /> Liberar
                      </Button>
                    )}
                  </div>
                )}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
