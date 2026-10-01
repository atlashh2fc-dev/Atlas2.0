"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Clock, ExternalLink, X, XCircle } from "lucide-react";
import {
  resolveQuotation,
  type QuotationCampaign,
  type QuotationChannel,
  type QuotationRow,
  type QuotationState,
} from "@/app/actions/cotizaciones";
import { Avatar, Button, DataTable, Field, Select, SlideOver, useToast, type BadgeTone, type Column } from "@/components/ui";
import { cn } from "@/lib/utils";
import { dateTimeLabel, dayLabel } from "@/components/record-kit";

/**
 * Cotizaciones enviadas del ejecutivo. Cada una se marca vendida o no vendida
 * sin volver a llamar: el cliente suele responder por WhatsApp o correo. La
 * venta va a Validación de ventas como cualquier otra; la RPC valida que el
 * registro sea del ejecutivo y que el motivo sea del flujo de la campaña.
 */
const STATE_BADGE: Record<QuotationState, { tone: BadgeTone; label: string; chip: string; icon: typeof Clock }> = {
  pendiente: { tone: "warning", label: "Pendiente", chip: "amber", icon: Clock },
  vendida: { tone: "success", label: "Vendida", chip: "green", icon: CheckCircle2 },
  no_vendida: { tone: "neutral", label: "No vendida", chip: "slate", icon: XCircle },
};

const VALIDATION_LABEL: Record<NonNullable<QuotationRow["validationStatus"]>, string> = {
  pendiente: "Supervisión por validar",
  aprobada: "Validada por supervisión",
  rechazada: "Rechazada por supervisión",
  anulada: "Venta anulada",
};

const CHANNELS: { value: QuotationChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "correo", label: "Correo" },
  { value: "presencial", label: "Presencial" },
  { value: "otro", label: "Otro (llamada, videollamada…)" },
];

const FILTERS: { value: QuotationState | "todas"; label: string }[] = [
  { value: "pendiente", label: "Pendientes" },
  { value: "vendida", label: "Vendidas" },
  { value: "no_vendida", label: "No vendidas" },
  { value: "todas", label: "Todas" },
];

/** "24 may · 09:27" en hora de Chile, igual que el resto de la ficha. */
const dateTime = { format: (date: Date) => dateTimeLabel(date.toISOString()) };

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** «POR PRECIO» → «Por precio», para mostrar el motivo guardado en mayúsculas. */
function sentence(value: string | null) {
  if (!value) return null;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

function stateDetail(row: QuotationRow) {
  if (row.state === "vendida") return row.validationStatus ? VALIDATION_LABEL[row.validationStatus] : null;
  if (row.state === "no_vendida") return sentence(row.decisionReason);
  return row.followUpAt ? `Seguimiento ${dateTime.format(new Date(row.followUpAt))}` : "Sin seguimiento agendado";
}

type Draft = {
  row: QuotationRow;
  result: "vendida" | "no_vendida";
  channel: QuotationChannel | "";
  reason: string;
  notes: string;
};

export function AgentQuotationsTable({ rows, campaigns }: { rows: QuotationRow[]; campaigns: QuotationCampaign[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<QuotationState | "todas">("pendiente");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();

  const campaignById = useMemo(() => new Map(campaigns.map((campaign) => [campaign.id, campaign])), [campaigns]);
  const showCampaign = campaigns.length > 1;
  const counts = useMemo(() => {
    const result: Record<QuotationState | "todas", number> = { pendiente: 0, vendida: 0, no_vendida: 0, todas: rows.length };
    for (const row of rows) result[row.state] += 1;
    return result;
  }, [rows]);
  const visible = filter === "todas" ? rows : rows.filter((row) => row.state === filter);
  const lostReasons = draft?.row.campaignId ? campaignById.get(draft.row.campaignId)?.lostReasons ?? [] : [];

  function open(row: QuotationRow, result: Draft["result"]) {
    setDraft({ row, result, channel: "", reason: "", notes: "" });
  }

  function confirm() {
    if (!draft) return;
    if (!draft.channel) {
      toast({ tone: "danger", message: "Elige por qué canal te confirmó el cliente." });
      return;
    }
    if (draft.result === "no_vendida" && !draft.reason) {
      toast({ tone: "danger", message: "Elige el motivo por el que no se vendió." });
      return;
    }
    const { row, result, channel, reason, notes } = draft;
    startTransition(async () => {
      const response = await resolveQuotation({
        leadId: row.leadId,
        result,
        channel,
        reason: result === "no_vendida" ? reason : null,
        notes: notes.trim() || null,
      });
      if (!response.ok) {
        toast({ tone: "danger", message: response.error });
        return;
      }
      toast({
        tone: "success",
        message:
          result === "vendida"
            ? "Cotización vendida: la venta quedó en Validación de ventas para tu supervisor."
            : "Cotización marcada como no vendida.",
      });
      setDraft(null);
      router.refresh();
    });
  }

  const columns: Column<QuotationRow>[] = [
    {
      id: "cliente",
      header: "Cliente",
      value: (row) => row.leadName,
      exportValues: (row) => ({ Cliente: row.leadName, RUT: row.leadRut, Teléfono: row.leadPhone, Correo: row.leadEmail }),
      cell: (row) => (
        <Link href={`/dashboard/leads/${row.leadId}`} className="group flex min-w-0 items-center gap-3">
          <Avatar name={row.leadName} seed={row.leadRut ?? row.leadName} size="md" shape="square" />
          <span className="min-w-0">
            <span className="block max-w-72 truncate font-medium text-foreground group-hover:text-primary">
              {row.leadName ?? "Registro sin nombre"}
            </span>
            <span className="block text-xs tabular-nums text-muted-foreground">
              {[row.leadRut, row.leadPhone].filter(Boolean).join(" · ") || "—"}
            </span>
          </span>
        </Link>
      ),
    },
    ...(showCampaign
      ? [
          {
            id: "campana",
            header: "Campaña",
            value: (row: QuotationRow) => (row.campaignId ? campaignById.get(row.campaignId)?.name ?? null : null),
            cell: (row: QuotationRow) => {
              const name = row.campaignId ? campaignById.get(row.campaignId)?.name ?? null : null;
              return name ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={name} size="xs" shape="square" />
                  <span className="truncate text-foreground">{name}</span>
                </span>
              ) : (
                <span className="text-muted-foreground/60">—</span>
              );
            },
          },
        ]
      : []),
    {
      id: "cotizada",
      header: "Cotizada",
      value: (row) => row.quotedAt,
      exportValues: (row) => ({ "Fecha cotización": dateTime.format(new Date(row.quotedAt)), "Nota cotización": row.quoteNotes }),
      cell: (row) => (
        <span className="block whitespace-nowrap" title={dateTimeLabel(row.quotedAt)}>
          <span className="block text-foreground">{dayLabel(row.quotedAt)}</span>
          <span className="block text-xs text-muted-foreground">
            {daysSince(row.quotedAt) === 0 ? "Hoy" : daysSince(row.quotedAt) === 1 ? "Ayer" : `Hace ${daysSince(row.quotedAt)} días`}
          </span>
        </span>
      ),
    },
    {
      id: "nota",
      header: "Nota de la cotización",
      value: (row) => row.quoteNotes,
      sortable: false,
      cell: (row) => (
        <span className="line-clamp-2 max-w-80 text-sm text-muted-foreground" title={row.quoteNotes ?? undefined}>
          {row.quoteNotes ?? "—"}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      value: (row) => STATE_BADGE[row.state].label,
      exportValues: (row) => ({ Estado: STATE_BADGE[row.state].label, Detalle: stateDetail(row) }),
      cell: (row) => {
        const state = STATE_BADGE[row.state];
        const Icon = state.icon;
        return (
          <span className="flex items-center gap-2.5">
            <span className="icon-chip size-7 rounded-lg" data-tone={state.chip} aria-hidden="true">
              <Icon size={14} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{state.label}</span>
              <span
                className={cn(
                  "block max-w-[15rem] truncate text-xs",
                  row.validationStatus === "rechazada" ? "text-danger" : "text-muted-foreground"
                )}
                title={row.validationNote ?? stateDetail(row) ?? undefined}
              >
                {stateDetail(row)}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      id: "acciones",
      header: "",
      sortable: false,
      cell: (row) => {
        // Una venta aprobada solo la corrige supervisión; una pendiente o
        // rechazada todavía se puede dar vuelta.
        const locked = row.state === "vendida" && row.validationStatus === "aprobada";
        if (locked) return null;
        return (
          <span className="flex justify-end gap-1.5">
            {!(row.state === "vendida" && row.validationStatus === "pendiente") && (
              <Button size="sm" variant="secondary" onClick={() => open(row, "vendida")} aria-label={`Marcar vendida la cotización de ${row.leadName ?? "registro"}`}>
                <Check size={14} aria-hidden />
                Vendida
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => open(row, "no_vendida")}
              aria-label={`Marcar no vendida la cotización de ${row.leadName ?? "registro"}`}
            >
              <X size={14} aria-hidden />
              {row.state === "no_vendida" ? "Cambiar motivo" : "No vendida"}
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        rows={visible}
        columns={columns}
        getRowId={(row) => row.leadId}
        toolbar={
          // Vistas pegadas a la tabla que filtran, con su conteo en caja suave.
          <div role="tablist" aria-label="Filtrar cotizaciones por estado" className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((option) => {
              const active = filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "relative inline-flex h-11 shrink-0 items-center gap-2 px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums",
                      active ? "bg-foreground/[0.08] text-foreground" : "bg-surface-muted text-muted-foreground",
                      option.value === "pendiente" && counts.pendiente > 0 && "text-warning"
                    )}
                  >
                    {counts[option.value].toLocaleString("es-CL")}
                  </span>
                  <span aria-hidden="true" className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", active ? "bg-primary" : "bg-transparent")} />
                </button>
              );
            })}
          </div>
        }
        storageKey="mis-cotizaciones"
        exportFilename="mis-cotizaciones"
        emptyTitle={filter === "pendiente" ? "No tienes cotizaciones pendientes" : "No hay cotizaciones en este estado"}
        emptyDescription="Cuando tipifiques una gestión como «Cotización enviada», aparecerá aquí para que registres si se vendió."
      />

      <SlideOver
        open={draft !== null}
        onClose={() => (pending ? undefined : setDraft(null))}
        width="sm"
        title={draft?.result === "vendida" ? "Cotización vendida" : "Cotización no vendida"}
        description={
          draft?.result === "vendida"
            ? "Queda como venta por validar: tu supervisor la aprueba en Validación de ventas."
            : "La cotización se cierra con el motivo que elijas. Su agenda de seguimiento se cancela."
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            {draft && (
              <Link
                href={`/dashboard/leads/${draft.row.leadId}`}
                className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink size={14} aria-hidden />
                Abrir ficha
              </Link>
            )}
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant={draft?.result === "vendida" ? "primary" : "danger"} onClick={confirm} disabled={pending}>
              {pending ? "Guardando…" : draft?.result === "vendida" ? "Confirmar venta" : "Confirmar no vendida"}
            </Button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4 text-sm">
            {/* Identidad del cliente, igual que en la tabla: avatar y dos líneas. */}
            <div className="flex items-start gap-3 border-b border-border pb-4">
              <Avatar name={draft.row.leadName} seed={draft.row.leadRut ?? draft.row.leadName} size="md" shape="square" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{draft.row.leadName ?? "Registro sin nombre"}</p>
                <p className="text-xs text-muted-foreground">
                  Cotizada el {dateTime.format(new Date(draft.row.quotedAt))}
                  {draft.row.leadEmail ? ` · ${draft.row.leadEmail}` : ""}
                </p>
                {draft.row.quoteNotes && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{draft.row.quoteNotes}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Resultado">
              {(["vendida", "no_vendida"] as const).map((result) => (
                <button
                  key={result}
                  type="button"
                  role="radio"
                  aria-checked={draft.result === result}
                  onClick={() => setDraft({ ...draft, result })}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    draft.result === result
                      ? result === "vendida"
                        ? "border-success bg-success/10 text-success"
                        : "border-danger bg-danger/10 text-danger"
                      : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground"
                  )}
                >
                  {result === "vendida" ? "Se vendió" : "No se vendió"}
                </button>
              ))}
            </div>

            <Field label="¿Por dónde te confirmó el cliente?">
              <Select
                value={draft.channel}
                onChange={(event) => setDraft({ ...draft, channel: event.target.value as QuotationChannel | "" })}
              >
                <option value="">Elige un canal</option>
                {CHANNELS.map((channel) => (
                  <option key={channel.value} value={channel.value}>
                    {channel.label}
                  </option>
                ))}
              </Select>
            </Field>

            {draft.result === "no_vendida" && (
              <Field label="Motivo">
                <Select value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}>
                  <option value="">Elige un motivo</option>
                  {lostReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Nota (opcional)">
              <textarea
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                rows={3}
                placeholder={
                  draft.result === "vendida" ? "Ej.: aceptó el plan mensual, paga con transferencia" : "Ej.: encontró otra opción más barata"
                }
                className="w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </Field>
          </div>
        )}
      </SlideOver>
    </>
  );
}
