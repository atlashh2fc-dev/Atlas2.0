"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/types";
import { bulkAssignLeads, distributeLeads } from "@/app/actions/leads";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
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

/**
 * Los ejecutivos como entidad principal del equipo, no como una columna de
 * leads. Cada fila abre la cartera del ejecutivo; la barra compara su cartera
 * con la más grande del equipo para ver de un vistazo quién puede recibir más.
 */
export function TeamAgentsTable({ rows }: { rows: TeamAgentRow[] }) {
  const largest = useMemo(() => Math.max(1, ...rows.map((row) => row.assigned)), [rows]);
  const columns = useMemo<Column<TeamAgentRow>[]>(
    () => [
      {
        id: "ejecutivo",
        header: "Ejecutivo",
        value: (row) => row.full_name,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={row.full_name} seed={row.id} size="md" />
            <span className="min-w-0">
              <span className="block max-w-[16rem] truncate font-medium text-foreground group-hover:text-primary">{row.full_name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {row.unmanaged > 0 ? `${row.unmanaged.toLocaleString("es-CL")} sin gestionar` : "Cartera gestionada"}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "cartera",
        header: "Cartera asignada",
        value: (row) => row.assigned,
        cell: (row) => (
          <span className="flex items-center gap-3">
            <span className="w-14 text-right font-medium tabular-nums text-foreground">{row.assigned.toLocaleString("es-CL")}</span>
            <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(row.assigned / largest) * 100}%` }} />
            </span>
          </span>
        ),
      },
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
        cell: (row) => <span className={row.today > 0 ? "text-foreground" : "text-muted-foreground"}>{row.today}</span>,
      },
      {
        id: "vencidas",
        header: "Agendas vencidas",
        align: "right",
        value: (row) => row.overdue,
        cell: (row) =>
          row.overdue > 0 ? <Badge tone="danger">{row.overdue}</Badge> : <span className="text-muted-foreground">0</span>,
      },
    ],
    [largest]
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      rowHref={(row) => `/dashboard/leads?agent=${row.id}`}
      rowActionLabel={() => "Ver cartera"}
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
  const [unassigning, setUnassigning] = useState<TeamLeadRow[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);

  const report = useCallback(
    (ok: number, skipped: number, error: string | null, title: string) => {
      if (error) {
        console.error(`[equipo] ${title}:`, error);
        toast({ tone: "danger", message: "No se pudo completar la asignación. Actualiza la página e inténtalo otra vez; si sigue fallando, avisa a soporte." });
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
      {
        // Nombre y RUT en una celda de dos líneas; el Excel los sigue
        // exportando en columnas separadas.
        id: "registro",
        header: "Registro",
        value: (row) => row.full_name,
        exportValues: (row) => ({ Registro: row.full_name, RUT: row.rut ?? "" }),
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={row.full_name} seed={row.rut ?? row.full_name} size="md" shape="square" />
            <span className="min-w-0">
              <span className="block max-w-[18rem] truncate font-medium text-foreground group-hover:text-primary">{row.full_name}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.rut ?? "Sin RUT"}</span>
            </span>
          </span>
        ),
      },
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
          row.assigned_name ? (
            <span className="flex items-center gap-2">
              <Avatar name={row.assigned_name} size="xs" />
              <span className="truncate text-foreground">{row.assigned_name}</span>
            </span>
          ) : (
            <Badge tone="warning">Sin asignar</Badge>
          ),
      },
    ],
    []
  );

  const bulkActions = useMemo<BulkAction<TeamLeadRow>[]>(
    () => [
      { id: "assign", label: "Asignar a…", onAction: (selected) => setAssigning(selected) },
      { id: "distribute", label: "Repartir por carga…", onAction: (selected) => setDistributing(selected) },
      {
        // Deja a los ejecutivos sin esos registros: se confirma antes.
        id: "unassign",
        label: "Quitar asignación",
        variant: "ghost",
        onAction: (selected) => setUnassigning(selected),
      },
    ],
    []
  );

  const unassignCount = unassigning?.length ?? 0;
  const unassignOwners = new Set((unassigning ?? []).map((row) => row.assigned_name).filter(Boolean)).size;

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

      <ConfirmDialog
        open={unassigning !== null}
        options={{
          title: `¿Quitar la asignación de ${unassignCount} ${unassignCount === 1 ? "registro" : "registros"}?`,
          description:
            unassignOwners > 0
              ? `Salen de la cartera de ${unassignOwners} ${unassignOwners === 1 ? "ejecutivo" : "ejecutivos"} y quedan sin asignar hasta que los repartas de nuevo. Sus gestiones anteriores no se borran.`
              : "Quedan sin asignar hasta que los repartas de nuevo. Sus gestiones anteriores no se borran.",
          confirmLabel: `Quitar ${unassignCount} ${unassignCount === 1 ? "asignación" : "asignaciones"}`,
          tone: "danger",
        }}
        onCancel={() => setUnassigning(null)}
        onConfirm={() => {
          const selected = unassigning ?? [];
          setUnassigning(null);
          startTransition(async () => {
            const result = await bulkAssignLeads(selected.map((row) => row.id), null);
            report(result.ok, result.skipped, result.error, "Registros liberados");
          });
        }}
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
