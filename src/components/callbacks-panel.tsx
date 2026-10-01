"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { rescheduleCallbacks, releaseCallbacksToPool } from "@/app/actions/admin";
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  Field,
  Input,
  Select,
  SlideOver,
  useToast,
  type BulkAction,
  type Column,
} from "@/components/ui";

export type CallbackRow = {
  id: string;
  full_name: string;
  phone: string | null;
  campaign: string | null;
  owner_id: string | null;
  owner_name: string;
  next_action_at: string;
  attempts: number;
  mode: "personal" | "campaign";
  overdue_minutes: number;
};

const DAY_FORMAT = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short" });
const HOUR_FORMAT = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });

/** "24 may · 09:27", siempre en hora de Chile (el navegador puede estar en otra zona). */
function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${DAY_FORMAT.format(date).replace(".", "")} · ${HOUR_FORMAT.format(date)}`;
}

function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * Control del supervisor sobre los compromisos agendados: ver los que nadie
 * cumplió, moverlos de fecha o de ejecutivo, o soltarlos al discador para que
 * los tome el primero disponible.
 */
export function CallbacksPanel({
  rows,
  agents,
}: {
  rows: CallbackRow[];
  agents: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [rescheduling, setRescheduling] = useState<CallbackRow[] | null>(null);
  const [releasing, setReleasing] = useState<CallbackRow[] | null>(null);
  const [when, setWhen] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [keepSchedule, setKeepSchedule] = useState(false);

  const report = useCallback(
    (ok: number, error: string | null, title: string) => {
      if (error) {
        toast({ tone: "danger", message: `No se pudo completar: ${error}` });
        return;
      }
      toast({ tone: "success", message: `${title}: ${ok} compromiso${ok === 1 ? "" : "s"}` });
      router.refresh();
    },
    [router, toast]
  );

  const columns = useMemo<Column<CallbackRow>[]>(
    () => [
      {
        // Nombre y teléfono en una celda; el Excel los sigue separando.
        id: "registro",
        header: "Registro",
        value: (row) => row.full_name,
        exportValues: (row) => ({ Registro: row.full_name, "Teléfono": row.phone ?? "" }),
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={row.full_name} size="md" />
            <span className="min-w-0">
              <span className="block max-w-[16rem] truncate font-medium text-foreground group-hover:text-primary">{row.full_name}</span>
              <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">{row.phone ?? "Sin teléfono"}</span>
            </span>
          </span>
        ),
      },
      {
        id: "campana",
        header: "Campaña",
        value: (row) => row.campaign ?? "",
        cell: (row) =>
          row.campaign ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={row.campaign} size="xs" shape="square" />
              <span className="max-w-[12rem] truncate text-foreground">{row.campaign}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "ejecutivo",
        header: "Comprometido por",
        value: (row) => row.owner_name,
        cell: (row) =>
          row.mode === "campaign" ? (
            <span className="text-muted-foreground">En el pool</span>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={row.owner_name} size="xs" />
              <span className="max-w-[12rem] truncate text-foreground">{row.owner_name}</span>
            </span>
          ),
      },
      {
        // Hora y estado juntos: "vencido hace 2 h" ya dice el estado.
        id: "hora",
        header: "Hora comprometida",
        value: (row) => row.next_action_at,
        exportValues: (row) => ({
          "Hora comprometida": formatDateTime(row.next_action_at),
          Estado: row.overdue_minutes > 0 ? "Vencido" : "Por venir",
        }),
        cell: (row) => (
          <span className="block">
            <span className="block whitespace-nowrap tabular-nums text-foreground">{formatDateTime(row.next_action_at)}</span>
            {row.overdue_minutes > 0 ? (
              <Badge tone="danger" className="mt-0.5">
                Vencido hace {formatDelay(row.overdue_minutes)}
              </Badge>
            ) : (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                En {formatDelay(Math.abs(row.overdue_minutes))}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "intentos",
        header: "Intentos de entrega",
        align: "right",
        value: (row) => row.attempts,
        cell: (row) =>
          row.attempts === 0 ? (
            <Badge tone="warning">Sin intentar</Badge>
          ) : (
            <span className="tabular-nums">{row.attempts}</span>
          ),
      },
    ],
    []
  );

  const bulkActions = useMemo<BulkAction<CallbackRow>[]>(
    () => [
      { id: "reschedule", label: "Reagendar…", onAction: (selected) => setRescheduling(selected) },
      {
        id: "release",
        label: "Derivar al discador…",
        variant: "secondary",
        onAction: (selected) => setReleasing(selected),
      },
    ],
    []
  );

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        rowHref={(row) => `/dashboard/leads/${row.id}`}
        selectable
        bulkActions={bulkActions}
        storageKey="compromisos"
        exportFilename="compromisos-vencidos"
        emptyTitle="No hay compromisos agendados"
        emptyDescription="Cuando un ejecutivo agende una llamada con un cliente, aparecerá acá."
      />

      <SlideOver
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        title="Reagendar compromisos"
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
                  const selected = rescheduling ?? [];
                  const result = await rescheduleCallbacks(
                    selected.map((row) => row.id),
                    when,
                    newOwner || null
                  );
                  setRescheduling(null);
                  report(result.ok, result.error, "Compromisos reagendados");
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

        <Field label="Traspasar a otro ejecutivo (opcional)" className="mt-4">
          <Select value={newOwner} onChange={(event) => setNewOwner(event.target.value)}>
            <option value="">Mantener al ejecutivo actual</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.full_name}
              </option>
            ))}
          </Select>
        </Field>

        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <CalendarClock size={14} className="mt-0.5 flex-shrink-0" />
          A la nueva hora, el discador llama al cliente y le entra la llamada al ejecutivo responsable, siempre que
          esté conectado y disponible.
        </p>
      </SlideOver>

      <SlideOver
        open={releasing !== null}
        onClose={() => setReleasing(null)}
        title="Derivar al discador"
        description={`${releasing?.length ?? 0} seleccionados`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReleasing(null)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const selected = releasing ?? [];
                  const result = await releaseCallbacksToPool(
                    selected.map((row) => row.id),
                    keepSchedule
                  );
                  setReleasing(null);
                  report(result.ok, result.error, "Compromisos derivados al discador");
                })
              }
            >
              {pending ? "Derivando…" : "Derivar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Estos compromisos dejan de pertenecer a un ejecutivo: vuelven a la campaña y los atiende el primero que esté
          disponible. Queda registrado quién los derivó.
        </p>

        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 accent-primary"
            checked={keepSchedule}
            onChange={(event) => setKeepSchedule(event.target.checked)}
          />
          <span>
            Conservar la hora comprometida
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Si la desmarcas, el registro vuelve a la cola normal de la campaña y se marca según la prioridad del
              discador, no a una hora fija.
            </span>
          </span>
        </label>
      </SlideOver>
    </>
  );
}
