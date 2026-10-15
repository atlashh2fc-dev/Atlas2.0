"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { IntegrityAgentRow, IntegrityDetailRow, ManagementIntegrityReport } from "@/app/actions/management-integrity";
import { Avatar, DataTable, type Column } from "@/components/ui";
import { explainIntegrityCase, formatSeconds, integrityMotiveLabel } from "@/lib/integrity-copy";

/** Día y hora del cierre en hora de Chile ("15 oct · 12:40"). */
function formatWhen(iso: string): { day: string; time: string } {
  const date = new Date(iso);
  return {
    day: date
      .toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
      .replace(".", ""),
    time: date.toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Santiago",
    }),
  };
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

/** Un cero no pide atención: va en gris. */
function Count({ value, tone }: { value: number; tone?: "danger" | "muted" }) {
  if (value === 0) return <span className="text-muted-foreground/60">0</span>;
  if (tone === "danger") return <span className="font-semibold text-danger">{value.toLocaleString("es-CL")}</span>;
  return <span className="text-muted-foreground">{value.toLocaleString("es-CL")}</span>;
}

/** Lo que hay que revisar: cifra y qué parte de sus gestiones es. */
function ShareCell({ value, total }: { value: number; total: number }) {
  if (value === 0) return <span className="text-muted-foreground/60">0</span>;
  const share = (value / Math.max(total, 1)) * 100;
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      <span className={share >= 5 ? "font-semibold text-danger" : "font-semibold text-warning"}>{value.toLocaleString("es-CL")}</span>
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {share.toLocaleString("es-CL", { maximumFractionDigits: 1 })} %
      </span>
    </span>
  );
}

function BlockHeading({ id, title, description, action }: { id?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div id={id} className="mb-3 flex scroll-mt-4 flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Columnas por ejecutivo. Una señal que en todo el período está en cero no
 * ocupa columna: son tres columnas vacías que el supervisor tenía que leer
 * para concluir que no había nada.
 */
function agentColumns(totals: ManagementIntegrityReport["totals"]): Column<IntegrityAgentRow>[] {
  const columns: Column<IntegrityAgentRow>[] = [
    { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name, cell: (row) => <PersonCell name={row.full_name} /> },
    { id: "gestiones", header: "Gestiones", align: "right", value: (row) => row.gestiones },
    {
      id: "para_revisar",
      header: "Para revisar",
      align: "right",
      value: (row) => row.para_revisar,
      cell: (row) => <ShareCell value={row.para_revisar} total={row.gestiones} />,
    },
  ];
  if (totals.contacto_sin_conexion > 0) {
    columns.push({
      id: "sin_respaldo",
      header: "Contacto sin respaldo",
      align: "right",
      value: (row) => row.contacto_sin_conexion,
      cell: (row) => <Count value={row.contacto_sin_conexion} tone="danger" />,
    });
  }
  if (totals.cierres_rapidos > 0) {
    columns.push({
      id: "cierres_rapidos",
      header: "Contactos de segundos",
      align: "right",
      value: (row) => row.cierres_rapidos,
      cell: (row) => <Count value={row.cierres_rapidos} tone="danger" />,
    });
  }
  if (totals.rafagas > 0) {
    columns.push({
      id: "rafagas",
      header: "Cierres en ráfaga",
      align: "right",
      value: (row) => row.rafagas,
      cell: (row) => <Count value={row.rafagas} tone="danger" />,
    });
  }
  columns.push(
    {
      id: "reagendados",
      header: "Reagendadas sin contacto",
      align: "right",
      value: (row) => row.reagendados_sin_contacto,
      cell: (row) => <Count value={row.reagendados_sin_contacto} tone="muted" />,
    },
    {
      id: "mediana",
      header: "Duración típica",
      align: "right",
      value: (row) => row.mediana_segundos ?? 0,
      cell: (row) => <span className="text-muted-foreground">{formatSeconds(row.mediana_segundos)}</span>,
    },
  );
  return columns;
}

const DETAIL_COLUMNS: Column<IntegrityDetailRow>[] = [
  {
    id: "cuando",
    header: "Cuándo",
    value: (row) => row.ended_at,
    exportValues: (row) => ({ Cuándo: `${formatWhen(row.ended_at).day} ${formatWhen(row.ended_at).time}` }),
    cell: (row) => {
      const when = formatWhen(row.ended_at);
      return (
        <span className="block whitespace-nowrap">
          <span className="block text-foreground">{when.day}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">{when.time}</span>
        </span>
      );
    },
  },
  { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name, cell: (row) => <PersonCell name={row.full_name} /> },
  {
    id: "cliente",
    header: "Cliente y tipificación",
    value: (row) => row.lead_name,
    exportValues: (row) => ({ Cliente: row.lead_name, Tipificación: row.reason ?? "—" }),
    cell: (row) => (
      <span className="block min-w-0 max-w-64">
        <span className="block truncate text-foreground">{row.lead_name}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.reason ? sentenceCase(row.reason) : "Sin tipificación"}</span>
      </span>
    ),
  },
  {
    id: "que_no_calza",
    header: "Qué no calza",
    value: (row) => integrityMotiveLabel(row.motivo),
    exportValues: (row) => ({ Motivo: integrityMotiveLabel(row.motivo), Detalle: explainIntegrityCase(row) }),
    cell: (row) => <span className="block min-w-64 whitespace-normal text-foreground">{explainIntegrityCase(row)}</span>,
  },
  {
    id: "duracion",
    header: "Duración",
    align: "right",
    value: (row) => row.handle_seconds ?? 0,
    cell: (row) => <span className="text-muted-foreground">{formatSeconds(row.handle_seconds)}</span>,
  },
];

export function ManagementIntegrityTables({
  agents,
  detail,
  totals,
  selectedAgentId,
  query,
}: {
  agents: IntegrityAgentRow[];
  detail: IntegrityDetailRow[];
  totals: ManagementIntegrityReport["totals"];
  selectedAgentId: string | null;
  /** Parámetros de la página (período, campaña) que se conservan al filtrar. */
  query: Record<string, string>;
}) {
  const selectedAgent = agents.find((agent) => agent.agent_id === selectedAgentId) ?? null;

  // Abrir un ejecutivo conserva el período y la campaña, y baja a sus casos.
  function hrefFor(agentId: string | null) {
    const params = new URLSearchParams(query);
    if (agentId) params.set("ejecutivo", agentId);
    else params.delete("ejecutivo");
    const search = params.toString();
    return `/dashboard/reportes/integridad${search ? `?${search}` : ""}#casos`;
  }

  return (
    <>
      <section>
        <BlockHeading
          title="Por ejecutivo"
          description="Ordenado por lo que hay que revisar. Toca un ejecutivo para ver sus casos."
        />
        <DataTable
          rows={agents}
          columns={agentColumns(totals)}
          getRowId={(row) => row.agent_id}
          rowHref={(row) => hrefFor(row.agent_id)}
          rowActionLabel={() => "Ver sus casos"}
          storageKey="integridad-agentes-v2"
          exportFilename="integridad-por-ejecutivo"
          emptyTitle="Sin gestiones en el período"
          emptyDescription="Ajusta el período o la campaña para revisar otro tramo."
        />
      </section>

      <section>
        <BlockHeading
          id="casos"
          title={selectedAgent ? `Casos de ${selectedAgent.full_name}` : "Casos para revisar"}
          description={
            detail.length >= 500
              ? "Los 500 más recientes. Abre uno para ver la ficha y escuchar la grabación."
              : "Del más reciente al más antiguo. Abre uno para ver la ficha y escuchar la grabación."
          }
          action={
            selectedAgent && (
              <Link
                href={hrefFor(null)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border sm:min-h-9 border-border px-3 text-[13px] font-medium text-foreground hover:bg-surface-muted"
              >
                <X size={14} aria-hidden="true" />
                Ver todos los ejecutivos
              </Link>
            )
          }
        />
        <DataTable
          rows={detail}
          columns={DETAIL_COLUMNS}
          getRowId={(row) => row.call_id}
          rowHref={(row) => `/dashboard/leads/${row.lead_id}`}
          rowActionLabel={() => "Abrir ficha"}
          storageKey="integridad-casos"
          exportFilename="integridad-casos"
          emptyTitle={selectedAgent ? "Nada que revisar para este ejecutivo" : "Nada que revisar en el período"}
          emptyDescription="Cada contacto tipificado tiene su llamada en la central."
        />
      </section>
    </>
  );
}
