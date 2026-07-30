"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/types";
import { bulkAssignLeads, distributeLeads } from "@/app/actions/leads";
import {
  Badge,
  Button,
  DataTable,
  Field,
  Select,
  SlideOver,
  useToast,
  type BulkAction,
  type Column,
} from "@/components/ui";

const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((status) => [status.value, status.label]));

export type TeamAgentRow = {
  id: string;
  full_name: string;
  assigned: number;
  overdue: number;
  today: number;
  unmanaged: number;
};

export type TeamLeadRow = {
  id: string;
  full_name: string;
  rut: string | null;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
};

/** Los ejecutivos como entidad principal del equipo, no como una columna de leads. */
export function TeamAgentsTable({ rows }: { rows: TeamAgentRow[] }) {
  const columns = useMemo<Column<TeamAgentRow>[]>(
    () => [
      { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
      { id: "cartera", header: "Cartera asignada", align: "right", value: (row) => row.assigned },
      {
        id: "sin_gestionar",
        header: "Sin gestionar",
        align: "right",
        value: (row) => row.unmanaged,
        className: "text-muted-foreground",
      },
      {
        id: "hoy",
        header: "Agendas hoy",
        align: "right",
        value: (row) => row.today,
      },
      {
        id: "vencidas",
        header: "Agendas vencidas",
        align: "right",
        value: (row) => row.overdue,
        cell: (row) => <span className={row.overdue > 0 ? "font-medium text-danger" : undefined}>{row.overdue}</span>,
      },
      {
        id: "detalle",
        header: "",
        align: "right",
        sortable: false,
        cell: (row) => (
          <Link href={`/dashboard/leads?agent=${row.id}`} className="text-xs font-medium text-primary hover:underline">
            Ver cartera
          </Link>
        ),
      },
    ],
    []
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      storageKey="equipo-ejecutivos"
      exportFilename="carga-por-ejecutivo"
      emptyTitle="Sin ejecutivos en tu equipo"
      emptyDescription="Pide a un administrador que asigne ejecutivos a tu equipo."
    />
  );
}

/** Asignación de registros en lote, con reparto automático por carga. */
export function TeamLeadsAssignment({
  rows,
  agents,
}: {
  rows: TeamLeadRow[];
  agents: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [assigning, setAssigning] = useState<TeamLeadRow[] | null>(null);
  const [distributing, setDistributing] = useState<TeamLeadRow[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);

  const report = useCallback(
    (ok: number, skipped: number, error: string | null, title: string) => {
      if (error) {
        toast({ tone: "danger", message: `No se pudo completar: ${error}` });
        return;
      }
      toast({
        tone: "success",
        message: skipped > 0 ? `${title}: ${ok} asignados, ${skipped} omitidos` : `${title}: ${ok} asignados`,
      });
      router.refresh();
    },
    [router, toast]
  );

  const columns = useMemo<Column<TeamLeadRow>[]>(
    () => [
      { id: "registro", header: "Registro", value: (row) => row.full_name },
      { id: "rut", header: "RUT", value: (row) => row.rut ?? "", className: "text-muted-foreground" },
      {
        id: "estado",
        header: "Estado",
        value: (row) => STATUS_LABEL[row.status] ?? row.status,
        cell: (row) => <Badge tone="neutral">{STATUS_LABEL[row.status] ?? row.status}</Badge>,
      },
      {
        id: "asignado",
        header: "Asignado a",
        value: (row) => row.assigned_name ?? "",
        cell: (row) =>
          row.assigned_name ?? <span className="text-warning">Sin asignar</span>,
      },
    ],
    []
  );

  const bulkActions = useMemo<BulkAction<TeamLeadRow>[]>(
    () => [
      { id: "assign", label: "Asignar a…", onAction: (selected) => setAssigning(selected) },
      { id: "distribute", label: "Repartir por carga…", onAction: (selected) => setDistributing(selected) },
      {
        id: "unassign",
        label: "Quitar asignación",
        variant: "ghost",
        onAction: (selected) =>
          startTransition(async () => {
            const result = await bulkAssignLeads(selected.map((row) => row.id), null);
            report(result.ok, result.skipped, result.error, "Registros liberados");
          }),
      },
    ],
    [report, startTransition]
  );

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        rowHref={(row) => `/dashboard/leads/${row.id}`}
        selectable
        bulkActions={bulkActions}
        storageKey="equipo-asignacion"
        exportFilename="asignacion-de-registros"
        emptyTitle="No hay registros con estos filtros"
        emptyDescription="Ajusta el ejecutivo, la campaña o el estado."
      />

      <SlideOver
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        title="Asignar registros"
        description={`${assigning?.length ?? 0} seleccionados`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssigning(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!agentId || pending}
              onClick={() =>
                startTransition(async () => {
                  const selected = assigning ?? [];
                  const result = await bulkAssignLeads(selected.map((row) => row.id), agentId);
                  setAssigning(null);
                  report(result.ok, result.skipped, result.error, "Registros asignados");
                })
              }
            >
              {pending ? "Asignando…" : "Asignar"}
            </Button>
          </>
        }
      >
        <Field label="Ejecutivo">
          <Select value={agentId} onChange={(event) => setAgentId(event.target.value)} data-autofocus>
            <option value="">Selecciona un ejecutivo</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.full_name}
              </option>
            ))}
          </Select>
        </Field>
      </SlideOver>

      <SlideOver
        open={distributing !== null}
        onClose={() => setDistributing(null)}
        title="Repartir por carga"
        description={`${distributing?.length ?? 0} registros entre los ejecutivos que elijas`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDistributing(null)}>
              Cancelar
            </Button>
            <Button
              disabled={targets.length === 0 || pending}
              onClick={() =>
                startTransition(async () => {
                  const selected = distributing ?? [];
                  const result = await distributeLeads(selected.map((row) => row.id), targets);
                  setDistributing(null);
                  report(result.ok, result.skipped, result.error, "Registros repartidos");
                })
              }
            >
              {pending ? "Repartiendo…" : "Repartir"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Cada registro se entrega al ejecutivo con menos cartera en ese momento, así la carga queda equilibrada.
        </p>
        <div className="space-y-1">
          {agents.map((agent) => (
            <label
              key={agent.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={targets.includes(agent.id)}
                onChange={() =>
                  setTargets((current) =>
                    current.includes(agent.id)
                      ? current.filter((id) => id !== agent.id)
                      : [...current, agent.id]
                  )
                }
              />
              {agent.full_name}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTargets(targets.length === agents.length ? [] : agents.map((agent) => agent.id))}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          {targets.length === agents.length ? "Quitar todos" : "Seleccionar todos"}
        </button>
      </SlideOver>
    </>
  );
}
