"use client";

import type { IntegrityAgentRow, IntegrityDetailRow } from "@/app/actions/management-integrity";
import { Avatar, Badge, DataTable, type Column } from "@/components/ui";

function formatSeconds(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value < 60) return `${value.toFixed(1)} s`;
  return `${Math.floor(value / 60)} m ${Math.round(value % 60)} s`;
}

/** Día del cierre en hora de Chile ("24 may"). */
function formatDay(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
    .replace(".", "");
}

/** Hora con segundos: en integridad importa la cadencia entre cierres. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Santiago",
  });
}

/** Las tipificaciones llegan en mayúsculas desde el flujo; se leen mejor en tipo oración. */
function sentenceCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

function PersonCell({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size="sm" />
      <span className="truncate font-medium text-foreground">{name}</span>
    </span>
  );
}

/** Cifra de una señal: gris si es cero, con color solo cuando hay algo que mirar. */
function SignalCount({ value, tone = "warning" }: { value: number; tone?: "warning" | "danger" }) {
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  return <span className={tone === "danger" ? "font-medium text-danger" : "font-medium text-warning"}>{value.toLocaleString("es-CL")}</span>;
}

/** Título de bloque sobre una tabla, sin tarjeta extra: la tabla ya es la tarjeta. */
function BlockHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
    </div>
  );
}

const AGENT_COLUMNS: Column<IntegrityAgentRow>[] = [
  { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name, cell: (row) => <PersonCell name={row.full_name} /> },
  { id: "gestiones", header: "Gestiones", align: "right", value: (row) => row.gestiones },
  {
    id: "sospechosas",
    header: "Marcadas",
    align: "right",
    value: (row) => row.sospechosas,
    cell: (row) => {
      if (row.sospechosas === 0) return <span className="text-muted-foreground">0</span>;
      const share = row.sospechosas / Math.max(row.gestiones, 1);
      const danger = share > 0.25;
      return (
        <span className="ml-auto block w-24">
          <span className="flex items-baseline justify-end gap-1.5">
            <span className={danger ? "font-semibold text-danger" : "font-semibold text-warning"}>{row.sospechosas}</span>
            <span className="text-[11px] text-muted-foreground">{(share * 100).toFixed(0)}%</span>
          </span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span
              className={danger ? "block h-full rounded-full bg-danger" : "block h-full rounded-full bg-warning"}
              style={{ width: `${Math.min(100, share * 100)}%` }}
            />
          </span>
        </span>
      );
    },
  },
  { id: "instantaneos", header: "Cierres instantáneos", align: "right", value: (row) => row.cierres_instantaneos, cell: (row) => <SignalCount value={row.cierres_instantaneos} /> },
  { id: "sin_respaldo", header: "Contacto sin llamada", align: "right", value: (row) => row.contactos_sin_respaldo, cell: (row) => <SignalCount value={row.contactos_sin_respaldo} tone="danger" /> },
  { id: "rafagas", header: "En ráfaga", align: "right", value: (row) => row.rafagas, cell: (row) => <SignalCount value={row.rafagas} /> },
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
  {
    id: "cierre",
    header: "Cierre",
    value: (row) => row.ended_at,
    cell: (row) => (
      <span className="block whitespace-nowrap">
        <span className="block text-foreground">{formatDay(row.ended_at)}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">{formatTime(row.ended_at)}</span>
      </span>
    ),
  },
  { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name, cell: (row) => <PersonCell name={row.full_name} /> },
  {
    id: "registro",
    header: "Registro",
    value: (row) => row.lead_name,
    exportValues: (row) => ({ Registro: row.lead_name, "Tipificación": row.reason ?? "—" }),
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate text-foreground">{row.lead_name}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.reason ? sentenceCase(row.reason) : "Sin tipificación"}</span>
      </span>
    ),
  },
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
      <span className="flex flex-wrap gap-x-3 gap-y-1">
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
      <section>
        <BlockHeading title="Por ejecutivo" description="Señales acumuladas en el período; la barra muestra qué parte de sus gestiones quedó marcada." />
        <DataTable
          rows={agents}
          columns={AGENT_COLUMNS}
          getRowId={(row) => row.agent_id}
          storageKey="integridad-agentes"
          exportFilename="integridad-por-ejecutivo"
          emptyTitle="Sin gestiones en el período"
          emptyDescription="Ajusta el período o la campaña para revisar otro tramo."
        />
      </section>

      <section>
        <BlockHeading title="Gestiones marcadas" description="Hasta 500 gestiones, de la más reciente a la más antigua." />
        <DataTable
          rows={detail}
          columns={DETAIL_COLUMNS}
          getRowId={(row) => row.call_id}
          rowHref={(row) => `/dashboard/leads/${row.lead_id}`}
          rowActionLabel={() => "Abrir ficha"}
          storageKey="integridad-detalle"
          exportFilename="integridad-detalle"
          emptyTitle="Ninguna gestión marcada"
          emptyDescription="En este período no hay cierres instantáneos, contactos sin respaldo ni ráfagas."
        />
      </section>
    </>
  );
}
