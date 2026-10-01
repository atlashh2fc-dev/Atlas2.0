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
  Avatar,
  Button,
  HoverCard,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Select,
  SegmentTabs,
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

const ZONA = "America/Santiago";

function dateTimeLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${dayLabel(date)}, ${timeLabel(date)}`;
}

/** "22 may" (con año solo si no es el actual), en hora de Chile. */
function dayLabel(date: Date) {
  const sameYear =
    date.toLocaleDateString("es-CL", { year: "numeric", timeZone: ZONA }) ===
    new Date().toLocaleDateString("es-CL", { year: "numeric", timeZone: ZONA });
  return date
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: ZONA })
    .replace(".", "");
}

function timeLabel(date: Date) {
  return date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONA });
}

/** Fecha en dos líneas: el día manda, la hora acompaña. */
function DateCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="block whitespace-nowrap">
      <span className="block text-foreground">{dayLabel(date)}</span>
      <span className="block text-xs text-muted-foreground">{timeLabel(date)}</span>
    </span>
  );
}

/** "hace 3 días": lo que importa de "Actualizado" es cuánto lleva quieto. */
function relativeLabel(value: string, now: Date) {
  const date = new Date(value);
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "—";
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "Hace 1 mes" : `Hace ${months} meses`;
  return dayLabel(date);
}

/** Las tipificaciones llegan en mayúsculas desde el flujo; se leen mejor así. */
function sentenceCase(value: string) {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
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
    detail: lead.tipificacion_actual ? sentenceCase(lead.tipificacion_actual) : "Sin próxima acción",
    tone: "success",
    icon: CheckCircle2,
  };
}

/** Tono del chip de icono del estado (ver `.icon-chip` en globals.css). */
function stateChipTone(tone: QueueState["tone"]) {
  if (tone === "danger") return "rose";
  if (tone === "warning") return "amber";
  if (tone === "success") return "green";
  if (tone === "primary") return "primary";
  return "slate";
}

/** Contenido de la tarjeta flotante de un registro. */
function LeadPreview({
  lead,
  vertical,
  now,
}: {
  lead: LeadQueueRow;
  vertical: CampaignVertical;
  now: Date;
}) {
  const state = queueState(lead, now);
  const Icon = state.icon;
  const debt = vertical === "cobranza" ? readDebtSnapshot(lead.extra) : null;
  const rows: [string, string][] = [
    ["RUT", lead.rut ?? "—"],
    ["Teléfono", lead.phone?.trim() ? lead.phone : "Sin teléfono"],
    [vertical === "cobranza" ? "Próximo compromiso" : "Próxima agenda", dateTimeLabel(lead.next_action_at)],
    [vertical === "cobranza" ? "Último resultado" : "Última tipificación", lead.tipificacion_actual ? sentenceCase(lead.tipificacion_actual) : "Sin gestión"],
    ...(debt ? ([["Deuda", formatClp(debt.monto)]] as [string, string][]) : []),
    ["Actualizado", relativeLabel(lead.updated_at, now)],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={lead.full_name} seed={lead.rut ?? lead.full_name} size="lg" shape="square" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{lead.full_name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="icon-chip size-5 rounded-md" data-tone={stateChipTone(state.tone)}>
              <Icon size={11} />
            </span>
            <span className={state.tone === "danger" ? "font-medium text-danger" : "text-foreground"}>{state.label}</span>
          </p>
        </div>
      </div>
      <dl className="space-y-1.5 border-t border-border pt-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate text-right font-medium tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/dashboard/leads/${lead.id}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full" })}>
        Abrir ficha
      </Link>
    </div>
  );
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
        id: "registro",
        header: "Registro",
        value: (row) => row.full_name,
        cell: (row) => {
          const debt = vertical === "cobranza" ? readDebtSnapshot(row.extra) : null;
          return (
            <span className="flex min-w-0 items-center gap-3">
              <Avatar name={row.full_name} seed={row.rut ?? row.full_name} size="md" shape="square" />
              <span className="min-w-0">
                {/* Al pasar el mouse: el resumen del registro sin abrir la ficha. */}
                <HoverCard content={<LeadPreview lead={row} vertical={vertical} now={now} />}>
                  <span className="block max-w-[16rem] truncate font-medium text-foreground group-hover:text-primary" title={row.full_name}>
                    {row.full_name}
                  </span>
                </HoverCard>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {statusText(vertical, row.status)}
                  {debt?.curso ? ` · ${debt.curso}` : ""}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        id: "estado",
        header: "Estado operativo",
        value: (row) => queueState(row, now).label,
        cell: (row) => {
          const state = queueState(row, now);
          const Icon = state.icon;
          return (
            <span className="flex items-center gap-2.5">
              <span className="icon-chip size-7 rounded-lg" data-tone={stateChipTone(state.tone)}>
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className={state.tone === "danger" ? "block font-medium text-danger" : "block font-medium text-foreground"}>
                  {state.label}
                </span>
                <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">{state.detail}</span>
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
          <span className="block whitespace-nowrap">
            <span className="block text-foreground">{row.rut ?? "—"}</span>
            <span className={hasPhone(row) ? "block text-xs text-muted-foreground" : "block text-xs font-medium text-danger"}>
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
        exportValues: (row) => ({
          [vertical === "cobranza" ? "Próximo compromiso" : "Próxima agenda"]: dateTimeLabel(row.next_action_at),
        }),
        cell: (row) => <DateCell value={row.next_action_at} />,
      },
      {
        id: "tipificacion",
        header: vertical === "cobranza" ? "Último resultado" : "Última tipificación",
        value: (row) => row.tipificacion_actual ?? (row.managed_at ? "Gestionado" : ""),
        cell: (row) => {
          const text = row.tipificacion_actual ?? (row.managed_at ? "Gestionado" : null);
          return text ? (
            <span className="block max-w-[13rem] truncate text-foreground" title={text}>
              {sentenceCase(text)}
            </span>
          ) : (
            <span className="text-muted-foreground/60">Sin gestión</span>
          );
        },
      },
      {
        id: "actualizado",
        header: "Actualizado",
        value: (row) => row.updated_at,
        cell: (row) => (
          <span className="whitespace-nowrap text-muted-foreground" title={dateTimeLabel(row.updated_at)}>
            {relativeLabel(row.updated_at, now)}
          </span>
        ),
      },
    ];
  }, [now, vertical]);

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
      <DataTable
        rows={leads}
        columns={columns}
        getRowId={(row) => row.id}
        rowHref={(row) => `/dashboard/leads/${row.id}`}
        rowActionLabel={(row) => (hasPhone(row) ? action : "Revisar")}
        toolbar={
          <SegmentTabs
            label="Vistas de registros"
            activeId={view}
            tabs={LEAD_VIEWS.map((item) => ({
              id: item.id,
              label: item.label,
              href: withParam("view", item.id),
              count: counts[item.id],
              tone: item.id === "vencidas" ? "danger" : item.id === "bloqueados" ? "warning" : undefined,
            }))}
          />
        }
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
