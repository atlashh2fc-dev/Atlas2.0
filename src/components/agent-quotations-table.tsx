"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import {
  resolveQuotation,
  type QuotationCampaign,
  type QuotationChannel,
  type QuotationRow,
  type QuotationState,
} from "@/app/actions/cotizaciones";
import { Badge, Button, DataTable, Field, Select, SlideOver, useToast, type BadgeTone, type Column } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Cotizaciones enviadas del ejecutivo. Cada una se marca vendida o no vendida
 * sin volver a llamar: el cliente suele responder por WhatsApp o correo. La
 * venta va a Validación de ventas como cualquier otra; la RPC valida que el
 * registro sea del ejecutivo y que el motivo sea del flujo de la campaña.
 */
const STATE_BADGE: Record<QuotationState, { tone: BadgeTone; label: string }> = {
  pendiente: { tone: "warning", label: "Pendiente" },
  vendida: { tone: "success", label: "Vendida" },
  no_vendida: { tone: "neutral", label: "No vendida" },
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

const dateTime = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

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
        <Link href={`/dashboard/leads/${row.leadId}`} className="min-w-0">
          <span className="block max-w-72 truncate font-medium text-foreground hover:underline">
            {row.leadName ?? "Registro sin nombre"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {[row.leadRut, row.leadPhone].filter(Boolean).join(" · ") || "—"}
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
          },
        ]
      : []),
    {
      id: "cotizada",
      header: "Cotizada",
      value: (row) => row.quotedAt,
      exportValues: (row) => ({ "Fecha cotización": dateTime.format(new Date(row.quotedAt)), "Nota cotización": row.quoteNotes }),
      cell: (row) => (
        <span className="whitespace-nowrap text-sm">
          {dateOnly.format(new Date(row.quotedAt))}
          <span className="block text-xs text-muted-foreground">
            {daysSince(row.quotedAt) === 0 ? "hoy" : `hace ${daysSince(row.quotedAt)} d`}
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
      cell: (row) => (
        <span className="block">
          <Badge tone={STATE_BADGE[row.state].tone}>{STATE_BADGE[row.state].label}</Badge>
          <span
            className={cn(
              "mt-0.5 block text-xs",
              row.validationStatus === "rechazada" ? "text-danger" : "text-muted-foreground"
            )}
            title={row.validationNote ?? undefined}
          >
            {stateDetail(row)}
          </span>
        </span>
      ),
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
              <Button size="sm" onClick={() => open(row, "vendida")} aria-label={`Marcar vendida la cotización de ${row.leadName ?? "registro"}`}>
                <Check size={14} aria-hidden />
                Vendida
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
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
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtrar cotizaciones por estado">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              filter === option.value
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
            <span className="ml-1.5 tabular-nums">{counts[option.value].toLocaleString("es-CL")}</span>
          </button>
        ))}
      </div>

      <DataTable
        rows={visible}
        columns={columns}
        getRowId={(row) => row.leadId}
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
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
              <p className="font-medium">{draft.row.leadName ?? "Registro sin nombre"}</p>
              <p className="text-xs text-muted-foreground">
                Cotizada el {dateTime.format(new Date(draft.row.quotedAt))}
                {draft.row.leadEmail ? ` · ${draft.row.leadEmail}` : ""}
              </p>
              {draft.row.quoteNotes && <p className="mt-1 whitespace-pre-wrap text-xs">{draft.row.quoteNotes}</p>}
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
                    "rounded-md border px-3 py-2 text-sm font-medium",
                    draft.result === result
                      ? result === "vendida"
                        ? "border-success bg-success/10 text-success"
                        : "border-danger bg-danger/10 text-danger"
                      : "border-border text-muted-foreground hover:text-foreground"
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
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          </div>
        )}
      </SlideOver>
    </>
  );
}
