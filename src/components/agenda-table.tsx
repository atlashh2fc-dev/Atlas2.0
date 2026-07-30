"use client";

import Link from "next/link";
import { DataTable, buttonClasses, type Column } from "@/components/ui";

export type AgendaRow = {
  id: string;
  full_name: string;
  contact: string;
  campaign: string;
  tipificacion: string;
  next_action_at: string;
  overdue: boolean;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const COLUMNS: Column<AgendaRow>[] = [
  { id: "lead", header: "Registro", value: (row) => row.full_name },
  { id: "contacto", header: "RUT / teléfono", value: (row) => row.contact, className: "text-muted-foreground" },
  { id: "campana", header: "Campaña", value: (row) => row.campaign, className: "text-muted-foreground" },
  {
    id: "tipificacion",
    header: "Última tipificación",
    value: (row) => row.tipificacion,
    className: "text-muted-foreground",
  },
  {
    id: "agenda",
    header: "Agenda",
    value: (row) => row.next_action_at,
    cell: (row) => (
      <span className={row.overdue ? "font-medium text-danger" : "text-foreground"}>
        {row.overdue ? "Vencida · " : ""}
        {formatDateTime(row.next_action_at)}
      </span>
    ),
  },
  {
    id: "accion",
    header: "",
    align: "right",
    sortable: false,
    cell: (row) => (
      <Link href={`/dashboard/leads/${row.id}`} className={buttonClasses({ size: "sm" })}>
        Llamar ahora
      </Link>
    ),
  },
];

export function AgendaTable({ rows }: { rows: AgendaRow[] }) {
  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      rowHref={(row) => `/dashboard/leads/${row.id}`}
      storageKey="agenda"
      exportFilename="mi-agenda"
      emptyTitle="No tienes agendas pendientes"
      emptyDescription="Cuando agendes un seguimiento desde la ficha de un registro, aparecerá acá ordenado por urgencia."
    />
  );
}
