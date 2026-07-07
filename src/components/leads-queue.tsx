"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, PhoneCall } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { Table, Thead, Th, Tbody, Tr, Td, TableEmpty, buttonClasses } from "@/components/ui";

const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.label]));

export type LeadQueueView = "prioridad" | "vencidas" | "hoy" | "disponibles" | "bloqueados" | "gestionados";

export type LeadQueueRow = {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  status: string;
  assigned_to: string | null;
  managed_by: string | null;
  team_id: string | null;
  campaign_id: string | null;
  updated_at: string;
  next_action_at: string | null;
  tipificacion_actual: string | null;
  assignment_status: string | null;
  workflow_status: string | null;
  managed_at: string | null;
};

type LeadQueueCopy = {
  action: string;
};

type QueueState = {
  label: string;
  detail: string;
  rank: number;
  tone: "danger" | "warning" | "primary" | "muted" | "success";
  icon: ComponentType<{ size?: number; className?: string }>;
};

function hasPhone(lead: LeadQueueRow) {
  return Boolean(lead.phone?.trim());
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function getQueueState(lead: LeadQueueRow, now: Date): QueueState {
  const nextActionAt = lead.next_action_at ? new Date(lead.next_action_at) : null;
  const todayEnd = endOfToday();
  const managed = Boolean(lead.managed_at) || lead.assignment_status === "managed" || lead.workflow_status === "managed";

  if (!hasPhone(lead)) {
    return {
      label: "Bloqueado",
      detail: "Sin telefono",
      rank: 0,
      tone: "danger",
      icon: AlertTriangle,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime()) && nextActionAt <= now) {
    return {
      label: "Urgente",
      detail: `Vencida: ${dateLabel(lead.next_action_at)}`,
      rank: 1,
      tone: "danger",
      icon: AlertTriangle,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime()) && nextActionAt <= todayEnd) {
    return {
      label: "Agenda hoy",
      detail: dateLabel(lead.next_action_at),
      rank: 2,
      tone: "warning",
      icon: CalendarClock,
    };
  }

  if (!managed) {
    return {
      label: "Disponible",
      detail: "Listo para gestionar",
      rank: 3,
      tone: "primary",
      icon: PhoneCall,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime())) {
    return {
      label: "Agenda futura",
      detail: dateLabel(lead.next_action_at),
      rank: 4,
      tone: "muted",
      icon: CalendarClock,
    };
  }

  return {
    label: "Gestionado",
    detail: lead.tipificacion_actual ?? "Sin proxima accion",
    rank: 5,
    tone: "success",
    icon: CheckCircle2,
  };
}

function stateClass(tone: QueueState["tone"]) {
  if (tone === "danger") return "bg-danger-bg text-danger";
  if (tone === "warning") return "bg-warning-bg text-warning";
  if (tone === "success") return "bg-success-bg text-success";
  if (tone === "primary") return "bg-primary text-primary-foreground";
  return "bg-surface-muted text-muted-foreground";
}

function sortRows(
  rows: { lead: LeadQueueRow; state: QueueState }[]
) {
  return [...rows].sort((a, b) => {
    const rankDiff = a.state.rank - b.state.rank;
    if (rankDiff !== 0) return rankDiff;
    const aAgenda = a.lead.next_action_at ? new Date(a.lead.next_action_at).getTime() : Number.POSITIVE_INFINITY;
    const bAgenda = b.lead.next_action_at ? new Date(b.lead.next_action_at).getTime() : Number.POSITIVE_INFINITY;
    if (aAgenda !== bAgenda) return aAgenda - bAgenda;
    return new Date(b.lead.updated_at).getTime() - new Date(a.lead.updated_at).getTime();
  });
}

export function LeadsQueue({
  leads,
  initialView,
  copy,
  errorMessage,
}: {
  leads: LeadQueueRow[];
  initialView: LeadQueueView;
  copy: LeadQueueCopy;
  errorMessage?: string | null;
}) {
  const [view, setView] = useState<LeadQueueView>(initialView);

  const { counts, rows, priorityCount } = useMemo(() => {
    const now = new Date();
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const stateRows = leads.map((lead) => ({ lead, state: getQueueState(lead, now) }));
    const priorityRows = sortRows(stateRows).slice(0, 75);
    const filteredRows = sortRows(
      stateRows.filter(({ lead, state }) => {
        if (view === "vencidas") return state.label === "Urgente";
        if (view === "hoy") {
          if (!lead.next_action_at) return false;
          const date = new Date(lead.next_action_at);
          return !Number.isNaN(date.getTime()) && date >= todayStart && date <= todayEnd;
        }
        if (view === "disponibles") return state.label === "Disponible";
        if (view === "bloqueados") return state.label === "Bloqueado";
        if (view === "gestionados") return state.label === "Gestionado";
        return true;
      })
    ).slice(0, 75);

    return {
      rows: filteredRows,
      priorityCount: priorityRows.length,
      counts: {
        vencidas: stateRows.filter((row) => row.state.label === "Urgente").length,
        hoy: leads.filter((lead) => {
          if (!lead.next_action_at) return false;
          const date = new Date(lead.next_action_at);
          return !Number.isNaN(date.getTime()) && date >= todayStart && date <= todayEnd;
        }).length,
        disponibles: stateRows.filter((row) => row.state.label === "Disponible").length,
        bloqueados: stateRows.filter((row) => row.state.label === "Bloqueado").length,
        gestionados: stateRows.filter((row) => row.state.label === "Gestionado").length,
      },
    };
  }, [leads, view]);

  const tabs: { view: LeadQueueView; label: string; count?: number }[] = [
    { view: "prioridad", label: "Prioridad", count: priorityCount },
    { view: "vencidas", label: "Vencidas", count: counts.vencidas },
    { view: "hoy", label: "Hoy", count: counts.hoy },
    { view: "disponibles", label: "Disponibles", count: counts.disponibles },
    { view: "bloqueados", label: "Bloqueados", count: counts.bloqueados },
    { view: "gestionados", label: "Gestionados", count: counts.gestionados },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QueueMetric label="Vencidas" value={counts.vencidas} tone="danger" />
        <QueueMetric label="Hoy" value={counts.hoy} tone="warning" />
        <QueueMetric label="Disponibles" value={counts.disponibles} tone="primary" />
        <QueueMetric label="Bloqueados" value={counts.bloqueados} tone="muted" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.view === view;
          return (
            <button
              key={tab.view}
              type="button"
              onClick={() => setView(tab.view)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-surface-muted"}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <Table className="min-w-[980px]">
          <Thead>
            <Th>Prioridad</Th>
            <Th>Lead</Th>
            <Th>Contacto</Th>
            <Th>Estado operativo</Th>
            <Th>Ultima gestion</Th>
            <Th />
          </Thead>
          <Tbody>
            {errorMessage && (
              <Tr>
                <Td colSpan={6} className="py-6 text-center text-danger">
                  Error al cargar leads: {errorMessage}
                </Td>
              </Tr>
            )}
            {!errorMessage && rows.length === 0 && (
              <TableEmpty colSpan={6}>No hay gestiones para este filtro.</TableEmpty>
            )}
            {rows.map(({ lead, state }, index) => {
              const Icon = state.icon;
              return (
                <Tr key={lead.id} className="hover:bg-surface-muted">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground">
                        {index + 1}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(state.tone)}`}>
                        <Icon size={13} />
                        {state.label}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {lead.full_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {STATUS_LABEL[lead.status] ?? lead.status}
                    </p>
                  </Td>
                  <Td muted>
                    <p>{lead.rut ?? "-"}</p>
                    <p className={hasPhone(lead) ? "" : "font-medium text-danger"}>{lead.phone ?? "Sin telefono"}</p>
                  </Td>
                  <Td>
                    <p className="text-sm text-foreground">{state.detail}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Actualizado: {new Date(lead.updated_at).toLocaleDateString("es-CL")}
                    </p>
                  </Td>
                  <Td muted>{lead.tipificacion_actual ?? (lead.managed_at ? "Gestionado" : "-")}</Td>
                  <Td align="right">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className={buttonClasses({
                        variant:
                          state.tone === "primary" || state.tone === "danger" || state.tone === "warning"
                            ? "primary"
                            : "secondary",
                        size: "sm",
                      })}
                    >
                      {hasPhone(lead) ? copy.action : "Revisar"}
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>
    </>
  );
}

function QueueMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "primary" | "muted";
}) {
  const valueClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "primary"
          ? "text-primary"
          : "text-muted-foreground";

  return (
    <div className="min-w-24 rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
