"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, PhoneCall } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { LEAD_VIEWS, type LeadView } from "@/lib/leads-query";
import {
  debtAgeTone,
  formatClp,
  leadStatusLabel,
  readDebtSnapshot,
  type CampaignVertical,
} from "@/lib/campaign-vertical";
import { bulkAssignLeads, bulkRescheduleLeads } from "@/app/actions/leads";
import {
  Badge,
  Button,
  ConfirmDialog,
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

function statusText(vertical: CampaignVertical, value: string) {
  return leadStatusLabel(vertical, value, STATUS_LABEL[value] ?? value);
}

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
  /** Datos de la carga; en cobranza trae la deuda, la mora y el alumno. */
  extra?: Record<string, unknown> | null;
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

/** El icono del estado lleva el color del tono; el texto va en `Badge`. */
function stateIconClass(tone: QueueState["tone"]) {
  if (tone === "danger") return "text-danger";
  if (tone === "warning") return "text-warning";
  if (tone === "success") return "text-success";
  if (tone === "primary") return "text-primary";
  return "text-muted-foreground";
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
  emptyDescription = "Cambia de vista o ajusta los filtros.",
  vertical = "ventas",
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
  /** Qué hacer con la vista vacía según quién mira: el ejecutivo no carga bases. */
  emptyDescription?: string;
  /** Vocabulario y columnas de la cola: cartera de cobranza o base comercial. */
  vertical?: CampaignVertical;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [assigning, setAssigning] = useState<LeadQueueRow[] | null>(null);
  const [rescheduling, setRescheduling] = useState<LeadQueueRow[] | null>(null);
  const [unassigning, setUnassigning] = useState<LeadQueueRow[] | null>(null);
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

  const columns = useMemo<Column<LeadQueueRow>[]>(() => {
    // La deuda es la razón de existir de la cola en cobranza: va junto al
    // nombre, no escondida en la ficha.
    const debtColumn: Column<LeadQueueRow> = {
      id: "deuda",
      header: "Deuda",
      value: (row) => readDebtSnapshot(row.extra)?.monto ?? 0,
      cell: (row) => {
        const debt = readDebtSnapshot(row.extra);
        if (!debt) return <span className="text-muted-foreground">—</span>;
        const tone = debtAgeTone(debt.diasMora);
        const toneClass =
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted-foreground";
        return (
          <span className="block">
            <span className="block font-medium tabular-nums text-foreground">{formatClp(debt.monto)}</span>
            <span className={`mt-0.5 block text-xs ${toneClass}`}>
              {debt.diasMora !== null ? `${debt.diasMora} días de mora` : "Sin mora informada"}
              {debt.cuotas !== null ? ` · ${debt.cuotas} cuota${debt.cuotas === 1 ? "" : "s"}` : ""}
            </span>
          </span>
        );
      },
    };

    return [
      {
        id: "estado",
        header: "Estado operativo",
        value: (row) => queueState(row, now).label,
        cell: (row) => {
          const state = queueState(row, now);
          const Icon = state.icon;
          return (
            <span className="inline-flex flex-col gap-1">
              <Badge tone={state.tone === "muted" ? "neutral" : state.tone === "primary" ? "info" : state.tone} dot={false} className="w-fit">
                <Icon size={13} className={stateIconClass(state.tone)} />
                {state.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{state.detail}</span>
            </span>
          );
        },
      },
      {
        id: "registro",
        header: "Registro",
        value: (row) => row.full_name,
        cell: (row) => {
          const debt = vertical === "cobranza" ? readDebtSnapshot(row.extra) : null;
          return (
            <span className="block">
              <span className="font-medium text-foreground">{row.full_name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {statusText(vertical, row.status)}
                {debt?.curso ? ` · ${debt.curso}` : ""}
              </span>
            </span>
          );
        },
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
      ...(vertical === "cobranza" ? [debtColumn] : []),
      {
        id: "agenda",
        header: vertical === "cobranza" ? "Próximo compromiso" : "Próxima agenda",
        value: (row) => row.next_action_at ?? "",
        cell: (row) => dateTimeLabel(row.next_action_at),
      },
      {
        id: "tipificacion",
        header: vertical === "cobranza" ? "Último resultado" : "Última tipificación",
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
        // Acción por fila: secundaria e igual en todas, con o sin teléfono. El
        // primario de la vista es la acción de la página, no cada registro.
        cell: (row) => (
          <Link href={`/dashboard/leads/${row.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {hasPhone(row) ? action : "Revisar"}
          </Link>
        ),
      },
    ];
  }, [now, action, vertical]);

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
        onAction: (rows) => setUnassigning(rows),
      },
    ];
  }, [canManage]);

  const unassignCount = unassigning?.length ?? 0;

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
              className={`inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
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
        emptyDescription={emptyDescription}
      />

      <ConfirmDialog
        open={unassigning !== null}
        options={{
          title: `¿Quitar la asignación de ${unassignCount.toLocaleString("es-CL")} ${unassignCount === 1 ? "registro" : "registros"}?`,
          description:
            "Quedan sin ejecutivo responsable y salen de las colas personales hasta que se vuelvan a asignar. Se puede deshacer asignándolos de nuevo.",
          confirmLabel: `Quitar asignación de ${unassignCount.toLocaleString("es-CL")}`,
          tone: "danger",
        }}
        onCancel={() => setUnassigning(null)}
        onConfirm={() => {
          const rows = unassigning ?? [];
          setUnassigning(null);
          startTransition(async () => {
            const result = await bulkAssignLeads(rows.map((row) => row.id), null);
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
