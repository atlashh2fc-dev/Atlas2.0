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
import { Avatar, Badge, Button, Select, Table, TableEmpty, Tbody, Td, Th, Thead, Tr, actionErrorMessage, useToast } from "@/components/ui";

const TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
});

function currentLabel(row: AgentCampaignBoardRow, viewerId: string) {
  if (!row.active_campaign_id) return <Badge tone="warning">Sin campaña</Badge>;
  const since = row.changed_at ? ` · ${TIME_FORMAT.format(new Date(row.changed_at))}` : "";
  // Campaña con su avatar y, debajo, de dónde salió: fijada (candado) o
  // elegida. Texto gris, sin cápsula: el candado ya dice lo importante.
  let origin;
  if (row.locked) {
    const who = row.assigned_by === viewerId ? "ti" : row.assigned_by_name ?? "otro supervisor";
    origin = (
      <span className="inline-flex items-center gap-1">
        <Lock size={11} className="text-primary" aria-hidden="true" /> Fijada por {who}
        {since}
      </span>
    );
  } else {
    origin = (
      <>
        {row.source === "prioridad" ? "Por prioridad" : "Elegida por el ejecutivo"}
        {since}
      </>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={row.active_campaign_name} seed={row.active_campaign_id} size="sm" shape="square" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{row.active_campaign_name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{origin}</span>
      </span>
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
        toast({ tone: "danger", message: actionErrorMessage(error) });
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
              <Td>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={row.full_name} seed={row.profile_id} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{row.full_name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[row.team_name, row.extension ? `Anexo ${row.extension}` : "Sin anexo"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </span>
              </Td>
              <Td>{currentLabel(row, viewerId)}</Td>
              <Td>
                {row.campaigns.length === 0 ? (
                  <Badge tone="neutral">Sin campañas con discador</Badge>
                ) : (
                  <ol className="space-y-1">
                    {row.campaigns.map((campaign, index) => (
                      <li key={campaign.campaign_id} className="flex items-center gap-1 text-xs">
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums ${index === 0 ? "bg-primary/12 text-primary" : "bg-surface-muted text-muted-foreground"}`}
                          aria-label={`Prioridad ${index + 1}`}
                        >
                          {index + 1}
                        </span>
                        <span className={`min-w-0 flex-1 truncate pl-1 ${index === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{campaign.name}</span>
                        <button
                          type="button"
                          aria-label={`Subir prioridad de ${campaign.name}`}
                          disabled={pending || index === 0}
                          onClick={() => move(row, index, -1)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        >
                          <ArrowUp size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar prioridad de ${campaign.name}`}
                          disabled={pending || index === row.campaigns.length - 1}
                          onClick={() => move(row, index, 1)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                        >
                          <ArrowDown size={16} aria-hidden="true" />
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
                      variant="secondary"
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
                        variant="ghost"
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
