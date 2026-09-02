"use client";

import Link from "next/link";
import { MessageCircle, Video } from "lucide-react";
import { Badge, DataTable, buttonClasses, type Column } from "@/components/ui";
import { AgendaCallButton } from "@/components/agenda-call-button";
import { cn } from "@/lib/utils";

export type AgendaRow = {
  id: string;
  full_name: string;
  contact: string;
  campaign: string;
  tipificacion: string;
  next_action_at: string;
  overdue: boolean;
  /** El sistema marcará al cliente a la hora acordada y te pasará la llamada. */
  auto: boolean;
  attempts: number;
  channel: "phone" | "whatsapp" | "video_meeting" | "in_person";
  conversationId: string | null;
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

function channelLabel(channel: AgendaRow["channel"]): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "video_meeting") return "Videollamada";
  if (channel === "in_person") return "Presencial";
  return "Llamada";
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
    id: "canal",
    header: "Canal",
    value: (row) => channelLabel(row.channel),
    cell: (row) => <Badge tone={row.channel === "whatsapp" ? "success" : "neutral"}>{channelLabel(row.channel)}</Badge>,
  },
  {
    id: "entrega",
    header: "Entrega",
    value: (row) => (row.auto ? "Automática" : "Manual"),
    cell: (row) =>
      row.auto ? (
        <span className="inline-flex flex-col gap-0.5">
          <Badge tone="info">Te entra sola</Badge>
          {row.attempts > 0 && (
            <span className="text-xs text-muted-foreground">
              {row.attempts} {row.attempts === 1 ? "intento" : "intentos"} de entrega
            </span>
          )}
        </span>
      ) : <span className="text-xs text-muted-foreground">Lo gestionas tú</span>,
  },
  {
    id: "accion",
    header: "",
    align: "right",
    sortable: false,
    cell: (row) => row.channel === "phone"
      ? <AgendaCallButton leadId={row.id} fullName={row.full_name} />
      : row.channel === "whatsapp" && row.conversationId
        ? (
            <Link
              href={`/dashboard/conversaciones/whatsapp?status=all&conversation=${row.conversationId}`}
              className={cn(buttonClasses({ variant: "secondary", size: "sm" }), "gap-1.5")}
            >
              <MessageCircle size={14} aria-hidden="true" /> Abrir chat
            </Link>
          )
        : (
            <Link
              href={`/dashboard/leads/${row.id}`}
              className={cn(buttonClasses({ variant: "secondary", size: "sm" }), "gap-1.5")}
            >
              <Video size={14} aria-hidden="true" /> Ver detalle
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
