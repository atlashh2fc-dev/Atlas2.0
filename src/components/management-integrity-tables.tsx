"use client";

import type { IntegrityAgentRow, IntegrityDetailRow } from "@/app/actions/management-integrity";
import { Badge, Card, DataTable, type Column } from "@/components/ui";

function formatSeconds(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value < 60) return `${value.toFixed(1)} s`;
  return `${Math.floor(value / 60)} m ${Math.round(value % 60)} s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const AGENT_COLUMNS: Column<IntegrityAgentRow>[] = [
  { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
  { id: "gestiones", header: "Gestiones", align: "right", value: (row) => row.gestiones },
  {
    id: "sospechosas",
    header: "Marcadas",
    align: "right",
    value: (row) => row.sospechosas,
    cell: (row) => row.sospechosas > 0 ? (
      <Badge tone={row.sospechosas / Math.max(row.gestiones, 1) > 0.25 ? "danger" : "warning"}>
        {row.sospechosas}
      </Badge>
    ) : <span className="text-muted-foreground">0</span>,
  },
  { id: "instantaneos", header: "Cierres instantáneos", align: "right", value: (row) => row.cierres_instantaneos },
  { id: "sin_respaldo", header: "Contacto sin llamada", align: "right", value: (row) => row.contactos_sin_respaldo },
  { id: "rafagas", header: "En ráfaga", align: "right", value: (row) => row.rafagas },
  {
    id: "mediana",
    header: "Mediana de gestión",
    align: "right",
    value: (row) => row.mediana_segundos ?? 0,
    cell: (row) => formatSeconds(row.mediana_segundos),
  },
  {
    id: "minimo",
    header: "Mínimo",
    align: "right",
    value: (row) => row.minimo_segundos ?? 0,
    cell: (row) => formatSeconds(row.minimo_segundos),
  },
];

const DETAIL_COLUMNS: Column<IntegrityDetailRow>[] = [
  { id: "cierre", header: "Cierre", value: (row) => row.ended_at, cell: (row) => formatDateTime(row.ended_at) },
  { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
  { id: "registro", header: "Registro", value: (row) => row.lead_name },
  { id: "tipificacion", header: "Tipificación", value: (row) => row.reason ?? "—" },
  {
    id: "duracion",
    header: "Duración",
    align: "right",
    value: (row) => row.handle_seconds ?? 0,
    cell: (row) => formatSeconds(row.handle_seconds),
  },
  {
    id: "desde_anterior",
    header: "Desde el anterior",
    align: "right",
    value: (row) => row.seconds_since_previous ?? 0,
    cell: (row) => formatSeconds(row.seconds_since_previous),
  },
  {
    id: "senales",
    header: "Señales",
    sortable: false,
    value: (row) => [
      row.cierre_instantaneo && "instantáneo",
      row.contacto_sin_respaldo && "sin llamada",
      row.rafaga && "ráfaga",
    ].filter(Boolean).join(", "),
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.cierre_instantaneo && <Badge tone="warning">Instantáneo</Badge>}
        {row.contacto_sin_respaldo && <Badge tone="danger">Contacto sin llamada</Badge>}
        {row.rafaga && <Badge tone="warning">Ráfaga</Badge>}
      </span>
    ),
  },
];

export function ManagementIntegrityTables({
  agents,
  detail,
}: {
  agents: IntegrityAgentRow[];
  detail: IntegrityDetailRow[];
}) {
  return (
    <>
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Por ejecutivo</h2>
        <DataTable
          rows={agents}
          columns={AGENT_COLUMNS}
          getRowId={(row) => row.agent_id}
          storageKey="integridad-agentes"
          exportFilename="integridad-por-ejecutivo"
          emptyTitle="Sin gestiones en el período"
          emptyDescription="Ajusta el período o la campaña para revisar otro tramo."
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-foreground">Gestiones marcadas</h2>
        <p className="mb-3 text-xs text-muted-foreground">Hasta 500 gestiones, de la más reciente a la más antigua.</p>
        <DataTable
          rows={detail}
          columns={DETAIL_COLUMNS}
          getRowId={(row) => row.call_id}
          rowHref={(row) => `/dashboard/leads/${row.lead_id}`}
          storageKey="integridad-detalle"
          exportFilename="integridad-detalle"
          emptyTitle="Ninguna gestión marcada"
          emptyDescription="En este período no hay cierres instantáneos, contactos sin respaldo ni ráfagas."
        />
      </Card>
    </>
  );
}
