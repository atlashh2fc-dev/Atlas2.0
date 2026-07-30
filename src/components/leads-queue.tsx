"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, PhoneCall } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { LEAD_VIEWS, type LeadView } from "@/lib/leads-query";
import { bulkAssignLeads, bulkRescheduleLeads } from "@/app/actions/leads";
import {
  Button,
  DataTable,
  Field,
  Input,
  Select,
  SlideOver,
  buttonClasses,
  useToast,
  type BulkAction,
  type Column,
} from "@/components/ui";

const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((status) => [status.value, status.label]));

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

type QueueState = {
  label: string;
  detail: string;
  tone: "danger" | "warning" | "primary" | "muted" | "success";
  icon: ComponentType<{ size?: number; className?: string }>;
};

function hasPhone(lead: LeadQueueRow) {
  return Boolean(lead.phone?.trim());
}

function dateTimeLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function queueState(lead: LeadQueueRow, now: Date): QueueState {
  const nextActionAt = lead.next_action_at ? new Date(lead.next_action_at) : null;
  const valid = nextActionAt && !Number.isNaN(nextActionAt.getTime());
  const managed =
    Boolean(lead.managed_at) || lead.assignment_status === "managed" || lead.workflow_status === "managed";

  if (!hasPhone(lead)) return { label: "Bloqueado", detail: "Sin teléfono", tone: "danger", icon: AlertTriangle };
  if (valid && nextActionAt! <= now)
    return { label: "Urgente", detail: `Vencida: ${dateTimeLabel(lead.next_action_at)}`, tone: "danger", icon: AlertTriangle };
  if (valid && nextActionAt! <= endOfToday())
    return { label: "Agenda hoy", detail: dateTimeLabel(lead.next_action_at), tone: "warning", icon: CalendarClock };
  if (!managed) return { label: "Disponible", detail: "Listo para gestionar", tone: "primary", icon: PhoneCall };
  if (valid) return { label: "Agenda futura", detail: dateTimeLabel(lead.next_action_at), tone: "muted", icon: CalendarClock };
  return {
    label: "Gestionado",
    detail: lead.tipificacion_actual ?? "Sin próxima acción",
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

export function LeadsQueue({
  leads,
  view,
  counts,
  page,
  pageCount,
  total,
  pageSize,
  action,
  agents,
  canManage,
  errorMessage,
}: {
  leads: LeadQueueRow[];
  view: LeadView;
  counts: Record<LeadView, number>;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  action: string;
  agents: { id: string; full_name: string }[];
  canManage: boolean;
  errorMessage?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [assigning, setAssigning] = useState<LeadQueueRow[] | null>(null);
  const [rescheduling, setRescheduling] = useState<LeadQueueRow[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [when, setWhen] = useState("");

  const withParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "page") params.delete("page");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  // Referencia temporal fija para clasificar la cola. Se renueva al navegar o
  // refrescar, que es cuando llegan filas nuevas desde el servidor.
  const now = useMemo(() => new Date(), []);

  const columns = useMemo<Column<LeadQueueRow>[]>(
    () => [
      {
        id: "estado",
        header: "Estado operativo",
        value: (row) => queueState(row, now).label,
        cell: (row) => {
          const state = queueState(row, now);
          const Icon = state.icon;
          return (
            <span className="inline-flex flex-col gap-1">
              <span
                className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(state.tone)}`}
              >
                <Icon size={13} />
                {state.label}
              </span>
              <span className="text-xs text-muted-foreground">{state.detail}</span>
            </span>
          );
        },
      },
      {
        id: "registro",
        header: "Registro",
        value: (row) => row.full_name,
        cell: (row) => (
          <span className="block">
            <span className="font-medium text-foreground">{row.full_name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
          </span>
        ),
      },
      {
        id: "contacto",
        header: "RUT / teléfono",
        value: (row) => row.rut ?? row.phone ?? "",
        cell: (row) => (
          <span className="block text-muted-foreground">
            <span className="block">{row.rut ?? "—"}</span>
            <span className={hasPhone(row) ? "block" : "block font-medium text-danger"}>
              {row.phone?.trim() ? row.phone : "Sin teléfono"}
            </span>
          </span>
        ),
      },
      {
        id: "agenda",
        header: "Próxima agenda",
        value: (row) => row.next_action_at ?? "",
        cell: (row) => dateTimeLabel(row.next_action_at),
      },
      {
        id: "tipificacion",
        header: "Última tipificación",
        value: (row) => row.tipificacion_actual ?? (row.managed_at ? "Gestionado" : ""),
        className: "text-muted-foreground",
      },
      {
        id: "actualizado",
        header: "Actualizado",
        value: (row) => row.updated_at,
        cell: (row) => new Date(row.updated_at).toLocaleDateString("es-CL"),
        className: "text-muted-foreground",
      },
      {
        id: "accion",
        header: "",
        align: "right",
        sortable: false,
        cell: (row) => (
          <Link
            href={`/dashboard/leads/${row.id}`}
            className={buttonClasses({ variant: hasPhone(row) ? "primary" : "secondary", size: "sm" })}
          >
            {hasPhone(row) ? action : "Revisar"}
          </Link>
        ),
      },
    ],
    [now, action]
  );

  const report = useCallback(
    (ok: number, skipped: number, error: string | null, title: string) => {
      if (error) {
        toast({ tone: "danger", message: `No se pudo completar: ${error}` });
        return;
      }
      toast({
        tone: "success",
        message: skipped > 0 ? `${title}: ${ok} actualizados, ${skipped} omitidos` : `${title}: ${ok} actualizados`,
      });
      router.refresh();
    },
    [router, toast]
  );

  const bulkActions = useMemo<BulkAction<LeadQueueRow>[] | undefined>(() => {
    if (!canManage) return undefined;
    return [
      { id: "assign", label: "Asignar a…", onAction: (rows) => setAssigning(rows) },
      { id: "reschedule", label: "Reagendar…", onAction: (rows) => setRescheduling(rows) },
      {
        id: "unassign",
        label: "Quitar asignación",
        variant: "ghost",
        onAction: (rows) =>
          startTransition(async () => {
            const result = await bulkAssignLeads(rows.map((row) => row.id), null);
            report(result.ok, result.skipped, result.error, "Registros liberados");
          }),
      },
    ];
  }, [canManage, report, startTransition]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {LEAD_VIEWS.map((item) => {
          const active = item.id === view;
          return (
            <Link
              key={item.id}
              href={withParam("view", item.id)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  active ? "bg-primary-foreground/20" : "bg-surface-muted"
                }`}
              >
                {counts[item.id].toLocaleString("es-CL")}
              </span>
            </Link>
          );
        })}
      </div>

      <DataTable
        rows={leads}
        columns={columns}
        getRowId={(row) => row.id}
        rowHref={(row) => `/dashboard/leads/${row.id}`}
        selectable={canManage}
        bulkActions={bulkActions}
        storageKey="registros"
        exportFilename="registros"
        page={page}
        pageCount={pageCount}
        total={total}
        serverPageSize={pageSize}
        onPageChange={(next) => router.push(withParam("page", String(next)))}
        error={errorMessage ?? null}
        emptyTitle="No hay registros para este filtro"
        emptyDescription="Cambia de vista, ajusta los filtros o carga una base nueva."
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
                  const rows = assigning ?? [];
                  const result = await bulkAssignLeads(rows.map((row) => row.id), agentId);
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
        <p className="mt-3 text-xs text-muted-foreground">
          Cambia el responsable de los registros seleccionados. Queda registrado el motivo y el origen del cambio.
        </p>
      </SlideOver>

      <SlideOver
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        title="Reagendar registros"
        description={`${rescheduling?.length ?? 0} seleccionados`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRescheduling(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!when || pending}
              onClick={() =>
                startTransition(async () => {
                  const rows = rescheduling ?? [];
                  const result = await bulkRescheduleLeads(rows.map((row) => row.id), when);
                  setRescheduling(null);
                  report(result.ok, result.skipped, result.error, "Agendas actualizadas");
                })
              }
            >
              {pending ? "Reagendando…" : "Reagendar"}
            </Button>
          </>
        }
      >
        <Field label="Nueva fecha y hora">
          <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} data-autofocus />
        </Field>
        <p className="mt-3 text-xs text-muted-foreground">
          Se mantiene el responsable actual de cada registro. Los registros sin responsable se omiten.
        </p>
      </SlideOver>
    </>
  );
}
