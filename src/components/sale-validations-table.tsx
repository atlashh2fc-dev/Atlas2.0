"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import { resolveSales, type SaleValidationRow, type SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { formatUf } from "@/lib/sale-validation-format";
import { Badge, Button, DataTable, Input, SlideOver, useToast, type BadgeTone, type BulkAction, type Column } from "@/components/ui";

/**
 * Tabla de la validación de ventas: la cola (por validar) y el buscador de
 * ventas ya decididas usan la misma. Selección múltiple con decisión en
 * bloque, acciones por fila y un panel lateral con el detalle completo.
 */
const STATUS_BADGE: Record<SaleValidationStatus, { tone: BadgeTone; label: string }> = {
  pendiente: { tone: "warning", label: "Por validar" },
  aprobada: { tone: "success", label: "Aprobada" },
  rechazada: { tone: "danger", label: "Rechazada" },
  anulada: { tone: "neutral", label: "Anulada" },
};

const dateTime = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function daysWaiting(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function decidedBy(row: SaleValidationRow) {
  if (row.decisionSource === "atlas1") return "Backoffice Atlas 1";
  if (row.decisionSource === "revision") return "Corrección de tipificación";
  return row.decidedByName ?? "—";
}

type Decision = { rows: SaleValidationRow[]; decision: "aprobada" | "rechazada" };

export function SaleValidationsTable({
  rows,
  mode,
  exportFilename,
}: {
  rows: SaleValidationRow[];
  /** `cola`: pendientes, con decisión por fila y en bloque. `buscador`: ventas ya decididas. */
  mode: "cola" | "buscador";
  exportFilename: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [detail, setDetail] = useState<SaleValidationRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function openDecision(next: Decision) {
    setNote("");
    setDecision(next);
  }

  function confirmDecision() {
    if (!decision) return;
    // Cambiar una decisión ya tomada también exige motivo, como en la base.
    const needsNote = decision.decision === "rechazada" || decision.rows.some((row) => row.status !== "pendiente");
    if (needsNote && !note.trim()) {
      toast({ tone: "danger", message: "Escribe el motivo antes de confirmar." });
      return;
    }
    startTransition(async () => {
      const result = await resolveSales({
        ids: decision.rows.map((row) => row.id),
        decision: decision.decision,
        note: note.trim() || null,
      });
      if (!result.ok) {
        toast({ tone: "danger", message: result.error });
        return;
      }
      const plural = result.count === 1 ? "venta" : "ventas";
      toast({
        tone: "success",
        message:
          decision.decision === "aprobada"
            ? `${result.count} ${plural} aprobada${result.count === 1 ? "" : "s"}: avanzan en el CRM.`
            : `${result.count} ${plural} rechazada${result.count === 1 ? "" : "s"}.`,
      });
      setDecision(null);
      setDetail(null);
      router.refresh();
    });
  }

  const columns = useMemo<Column<SaleValidationRow>[]>(() => {
    const base: Column<SaleValidationRow>[] = [
      {
        id: "empresa",
        header: "Empresa",
        value: (row) => row.leadName,
        exportValues: (row) => ({ Empresa: row.leadName, RUT: row.leadRut, Teléfono: row.leadPhone }),
        cell: (row) => (
          <button type="button" onClick={() => setDetail(row)} className="min-w-0 text-left">
            <span className="block max-w-72 truncate font-medium text-foreground hover:underline">
              {row.leadName ?? "Registro sin nombre"}
            </span>
            <span className="block text-xs text-muted-foreground">{row.leadRut ?? row.leadPhone ?? "—"}</span>
          </button>
        ),
      },
      { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.agentName },
      {
        id: "productos",
        header: "Productos",
        value: (row) => row.products.join(", "),
        sortable: false,
        cell: (row) =>
          row.products.length > 0 ? (
            <span className="flex max-w-64 flex-wrap gap-1">
              {row.products.map((product) => (
                <Badge key={product} tone="info">
                  {product}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-xs text-warning">Sin productos</span>
          ),
      },
      {
        id: "uf",
        header: "UF mensual",
        align: "right",
        value: (row) => row.ufAmount,
        cell: (row) => <span className="font-semibold tabular-nums">{formatUf(row.ufAmount)}</span>,
      },
      {
        id: "tipificada",
        header: "Tipificada",
        value: (row) => row.soldAt,
        exportValues: (row) => ({ Tipificada: dateTime.format(new Date(row.soldAt)) }),
        cell: (row) => (
          <span className="whitespace-nowrap text-sm">
            {dateOnly.format(new Date(row.soldAt))}
            {mode === "cola" && (
              <span
                className={`block text-xs ${daysWaiting(row.soldAt) > 7 ? "font-medium text-danger" : "text-muted-foreground"}`}
              >
                {daysWaiting(row.soldAt) === 0 ? "hoy" : `hace ${daysWaiting(row.soldAt)} d`}
              </span>
            )}
          </span>
        ),
      },
    ];

    if (mode === "buscador") {
      base.push(
        {
          id: "estado",
          header: "Estado",
          value: (row) => STATUS_BADGE[row.status].label,
          cell: (row) => <Badge tone={STATUS_BADGE[row.status].tone}>{STATUS_BADGE[row.status].label}</Badge>,
        },
        {
          id: "decidida",
          header: "Decisión",
          value: (row) => row.decidedAt,
          exportValues: (row) => ({
            "Fecha decisión": row.decidedAt ? dateTime.format(new Date(row.decidedAt)) : null,
            "Decidió": decidedBy(row),
            Motivo: row.decisionNote,
          }),
          cell: (row) => (
            <span className="whitespace-nowrap text-sm">
              {row.decidedAt ? dateOnly.format(new Date(row.decidedAt)) : "—"}
              <span className="block text-xs text-muted-foreground">{decidedBy(row)}</span>
            </span>
          ),
        },
      );
    } else {
      base.push({
        id: "acciones",
        header: "",
        sortable: false,
        cell: (row) => (
          <span className="flex justify-end gap-1.5">
            <Button
              size="sm"
              onClick={() => openDecision({ rows: [row], decision: "aprobada" })}
              aria-label={`Aprobar venta de ${row.leadName ?? "registro"}`}
            >
              <Check size={14} aria-hidden />
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openDecision({ rows: [row], decision: "rechazada" })}
              aria-label={`Rechazar venta de ${row.leadName ?? "registro"}`}
            >
              <X size={14} aria-hidden />
            </Button>
          </span>
        ),
      });
    }
    return base;
  }, [mode]);

  const bulkActions: BulkAction<SaleValidationRow>[] =
    mode === "cola"
      ? [
          { id: "aprobar", label: "Aprobar seleccionadas", variant: "primary", onAction: (selected) => openDecision({ rows: selected, decision: "aprobada" }) },
          { id: "rechazar", label: "Rechazar seleccionadas", variant: "danger", onAction: (selected) => openDecision({ rows: selected, decision: "rechazada" }) },
        ]
      : [];

  const decisionUf = decision?.rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0) ?? 0;
  const changing = decision?.rows.some((row) => row.status !== "pendiente") ?? false;

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        selectable
        bulkActions={bulkActions}
        storageKey={mode === "cola" ? "validacion-ventas-cola" : "validacion-ventas-buscador"}
        exportFilename={exportFilename}
        emptyTitle={mode === "cola" ? "No hay ventas por validar" : "No hay ventas con esos filtros"}
        emptyDescription={
          mode === "cola"
            ? "Cuando un ejecutivo cierre una llamada como VENTA EN VALIDACION, aparecerá aquí."
            : "Prueba con otro texto, otro rango de fechas o sin filtros."
        }
      />

      <SlideOver
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.leadName ?? "Venta"}
        description={detail ? [detail.leadRut && `RUT ${detail.leadRut}`, detail.campaignName].filter(Boolean).join(" · ") : undefined}
        footer={
          detail && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/leads/${detail.leadId}`}
                className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink size={14} aria-hidden />
                Abrir ficha
              </Link>
              {detail.status !== "aprobada" && detail.status !== "anulada" && (
                <Button onClick={() => openDecision({ rows: [detail], decision: "aprobada" })}>
                  <Check size={14} aria-hidden />
                  Aprobar
                </Button>
              )}
              {detail.status !== "rechazada" && detail.status !== "anulada" && (
                <Button variant={detail.status === "aprobada" ? "danger" : "secondary"} onClick={() => openDecision({ rows: [detail], decision: "rechazada" })}>
                  <X size={14} aria-hidden />
                  Rechazar
                </Button>
              )}
            </div>
          )
        }
      >
        {detail && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <Badge tone={STATUS_BADGE[detail.status].tone}>{STATUS_BADGE[detail.status].label}</Badge>
              <span className="text-lg font-semibold tabular-nums">{formatUf(detail.ufAmount)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Item label="Ejecutivo">{detail.agentName ?? "—"}</Item>
              <Item label="Tipificada">{dateTime.format(new Date(detail.soldAt))}</Item>
              <Item label="Teléfono">{detail.leadPhone ?? "—"}</Item>
              <Item label="Correo">{detail.recipientEmail ?? detail.leadEmail ?? "—"}</Item>
              <Item label="Equipo">{detail.teamName ?? "—"}</Item>
              <Item label="Estado del registro">{detail.leadStatus ?? "—"}</Item>
            </dl>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Productos</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.products.length > 0 ? (
                  detail.products.map((product) => (
                    <Badge key={product} tone="info">
                      {product}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-warning">El ejecutivo no registró productos.</span>
                )}
              </div>
            </div>
            {detail.agentNotes && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Observación del ejecutivo</p>
                <p className="whitespace-pre-wrap rounded-md bg-surface-muted px-3 py-2">{detail.agentNotes}</p>
              </div>
            )}
            {detail.decidedAt && (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Decisión</p>
                <p>
                  {decidedBy(detail)} · {dateTime.format(new Date(detail.decidedAt))}
                </p>
                {detail.decisionNote && <p className="mt-1 text-muted-foreground">{detail.decisionNote}</p>}
              </div>
            )}
          </div>
        )}
      </SlideOver>

      <SlideOver
        open={decision !== null}
        onClose={() => (pending ? undefined : setDecision(null))}
        width="sm"
        title={
          decision?.decision === "aprobada"
            ? decision.rows.length === 1 ? "Aprobar venta" : `Aprobar ${decision.rows.length} ventas`
            : decision && decision.rows.length > 1 ? `Rechazar ${decision.rows.length} ventas` : "Rechazar venta"
        }
        description={
          decision?.decision === "aprobada"
            ? "Avanzan en el CRM: el registro queda como convertido."
            : "No avanzan en el CRM. El motivo queda registrado y lo ve el ejecutivo en la ficha."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDecision(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant={decision?.decision === "aprobada" ? "primary" : "danger"} onClick={confirmDecision} disabled={pending}>
              {pending ? "Guardando…" : decision?.decision === "aprobada" ? "Confirmar aprobación" : "Confirmar rechazo"}
            </Button>
          </div>
        }
      >
        {decision && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
              <p className="font-medium">
                {decision.rows.length} {decision.rows.length === 1 ? "venta" : "ventas"} · {formatUf(decisionUf)}
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {decision.rows.map((row) => (
                  <li key={row.id} className="truncate">
                    {row.leadName ?? "Registro sin nombre"} · {row.agentName ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
            <label className="block text-xs font-medium text-muted-foreground">
              {decision.decision === "rechazada" || changing ? "Motivo (obligatorio)" : "Comentario (opcional)"}
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={decision.decision === "rechazada" ? "Ej.: el cliente no confirmó la contratación" : "Ej.: confirmada con el cliente"}
                className="mt-1"
                autoFocus
              />
            </label>
          </div>
        )}
      </SlideOver>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
