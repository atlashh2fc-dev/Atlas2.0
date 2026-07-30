"use client";

import Link from "next/link";
import { useState } from "react";
import { assignMailEngagementLead } from "@/app/actions/mail";
import { ActionForm, ActionSubmit, Badge, Button, Select, SlideOver, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export type MailQueueRow = {
  mail_campaign_id: string | null;
  mail_campaign_name: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  opened: boolean;
  clicked: boolean;
  last_event_at: string;
  priority_rank: number;
  priority_reason: string;
};

type AgentOption = { id: string; full_name: string; email: string };

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * La tabla mantiene un DOM acotado y abre un único panel de asignación. Antes
 * cada lead creaba su propio formulario y selector de todos los ejecutivos.
 */
export function MailEngagementQueue({
  rows,
  agents,
  nextHref,
  resetHref,
  total,
}: {
  rows: MailQueueRow[];
  agents: AgentOption[];
  nextHref: string | null;
  resetHref: string;
  total: number;
}) {
  const [selected, setSelected] = useState<MailQueueRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Th>Lead</Th>
            <Th>Señal</Th>
            <Th>Campaña</Th>
            <Th>Asignado</Th>
            <Th>Acción</Th>
          </Thead>
          <Tbody>
            {rows.length === 0 && <TableEmpty colSpan={5}>No hay leads con apertura o click para asignar.</TableEmpty>}
            {rows.map((row) => (
              <Tr key={`${row.mail_campaign_id ?? row.campaign_id}-${row.lead_id}`}>
                <Td>
                  <Link href={`/dashboard/leads/${row.lead_id}`} className="font-medium text-foreground hover:text-primary">
                    {row.full_name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.rut ?? "Sin RUT"} · {row.phone ?? row.email ?? "Sin contacto"}
                  </p>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {row.clicked && <Badge tone="success">Click</Badge>}
                    {row.opened && <Badge tone="warning">Apertura</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.last_event_at)}</p>
                </Td>
                <Td muted>
                  <p>{row.mail_campaign_name}</p>
                  <p className="text-xs">{row.campaign_name}</p>
                </Td>
                <Td muted>{row.assigned_to_name ?? "Sin asignar"}</Td>
                <Td>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setSelected(row)}>
                    {row.assigned_to ? "Reasignar" : "Asignar"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span>
          Mostrando {rows.length.toLocaleString("es-CL")} de {total.toLocaleString("es-CL")} priorizados.
        </span>
        <div className="flex items-center gap-2">
          {nextHref && (
            <Link href={nextHref} className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-foreground hover:bg-surface-muted">
              Cargar siguientes
            </Link>
          )}
          {nextHref && (
            <Link href={resetHref} className="rounded-md px-2.5 py-1 font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground">
              Volver al inicio
            </Link>
          )}
        </div>
      </div>

      <SlideOver
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `Asignar a ${selected.full_name}` : "Asignar lead"}
        description="La asignación se guarda de inmediato y la bandeja se actualiza sin recargar miles de filas."
      >
        {selected && (
          <ActionForm action={assignMailEngagementLead} success="Lead asignado correctamente." onSuccess={() => setSelected(null)} className="space-y-5">
            <input type="hidden" name="lead_id" value={selected.lead_id} />
            <input type="hidden" name="mail_campaign_id" value={selected.mail_campaign_id ?? ""} />

            <div className="rounded-lg border border-border bg-background p-4 text-sm">
              <p className="font-medium text-foreground">{selected.priority_reason}</p>
              <p className="mt-1 text-muted-foreground">Última señal: {formatDate(selected.last_event_at)}</p>
            </div>

            <label className="block text-sm font-medium text-foreground">
              Ejecutivo responsable
              <Select name="agent_id" fieldSize="md" defaultValue={selected.assigned_to ?? ""} required data-autofocus className="mt-1.5 w-full">
                <option value="" disabled>
                  Selecciona un ejecutivo
                </option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.full_name || agent.email}
                  </option>
                ))}
              </Select>
            </label>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
                Cancelar
              </Button>
              <ActionSubmit pendingLabel="Asignando…">Confirmar asignación</ActionSubmit>
            </div>
          </ActionForm>
        )}
      </SlideOver>
    </>
  );
}
