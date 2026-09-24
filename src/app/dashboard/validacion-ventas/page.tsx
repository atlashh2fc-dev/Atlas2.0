import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { BadgeCheck } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import {
  approveSale,
  countSaleValidations,
  listSaleValidations,
  rejectSale,
  type SaleValidationRow,
  type SaleValidationStatus,
} from "@/app/actions/validacion-ventas";
import { ActionForm, ActionSubmit, Badge, Callout, Card, EmptyState, Input, PageHeader, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Validación de ventas. En Atlas 1 la hacía un backoffice; en Geimser no hay
 * backoffice humano y la hace la supervisora del equipo. Aprobar deja el
 * registro como convertido; rechazar exige motivo y no lo avanza. Las RPC
 * vuelven a validar rol, empresa y equipo.
 */
const TABS: { status: SaleValidationStatus; label: string }[] = [
  { status: "pendiente", label: "Por validar" },
  { status: "aprobada", label: "Aprobadas" },
  { status: "rechazada", label: "Rechazadas" },
  { status: "anulada", label: "Anuladas" },
];

const STATUS_BADGE: Record<SaleValidationStatus, { tone: BadgeTone; label: string }> = {
  pendiente: { tone: "warning", label: "Por validar" },
  aprobada: { tone: "success", label: "Aprobada" },
  rechazada: { tone: "danger", label: "Rechazada" },
  anulada: { tone: "neutral", label: "Anulada" },
};

const dateTime = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatUf(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: 2 })} UF`;
}

function decisionLine(row: SaleValidationRow) {
  if (!row.decidedAt) return null;
  const when = dateTime.format(new Date(row.decidedAt));
  if (row.decisionSource === "atlas1") return `Validada en Atlas 1 · ${when}`;
  if (row.decisionSource === "revision") return `Anulada al corregir la tipificación · ${when}`;
  return `${row.decidedByName ?? "Supervisión"} · ${when}`;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground">{children}</dd>
    </div>
  );
}

function SaleCard({ row }: { row: SaleValidationRow }) {
  const badge = STATUS_BADGE[row.status];
  const decision = decisionLine(row);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/dashboard/leads/${row.leadId}`} className="font-semibold text-foreground hover:underline">
            {row.leadName ?? "Registro sin nombre"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[row.leadRut && `RUT ${row.leadRut}`, row.leadPhone, row.campaignName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Detail label="Ejecutivo">{row.agentName ?? "—"}</Detail>
        <Detail label="Tipificada">{dateTime.format(new Date(row.soldAt))}</Detail>
        <Detail label="UF mensual">{formatUf(row.ufAmount)}</Detail>
        <Detail label="Correo">{row.recipientEmail ?? row.leadEmail ?? "—"}</Detail>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        {row.products.length > 0 ? (
          row.products.map((product) => (
            <Badge key={product} tone="info">
              {product}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-warning">El ejecutivo no registró productos.</span>
        )}
      </div>

      {row.agentNotes && (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-foreground">
          <span className="text-xs text-muted-foreground">Observación del ejecutivo: </span>
          {row.agentNotes}
        </p>
      )}

      {decision && (
        <p className="text-xs text-muted-foreground">
          {decision}
          {row.decisionNote && row.decisionSource !== "atlas1" && row.decisionSource !== "revision" && (
            <span className="text-foreground"> — {row.decisionNote}</span>
          )}
        </p>
      )}

      {row.status === "pendiente" && (
        <div className="grid gap-2 border-t border-border pt-3 md:grid-cols-2">
          <ActionForm action={approveSale} success="Venta aprobada: el registro quedó como convertido" className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={row.id} />
            <Input name="note" placeholder="Comentario (opcional)" aria-label="Comentario de la aprobación" className="h-8 min-w-0 flex-1 text-xs" />
            <ActionSubmit size="sm" pendingLabel="Aprobando…">
              Aprobar
            </ActionSubmit>
          </ActionForm>
          <ActionForm action={rejectSale} success="Venta rechazada: el registro no avanza" className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={row.id} />
            <Input name="note" required placeholder="Motivo del rechazo" aria-label="Motivo del rechazo" className="h-8 min-w-0 flex-1 text-xs" />
            <ActionSubmit variant="danger" size="sm" pendingLabel="Rechazando…">
              Rechazar
            </ActionSubmit>
          </ActionForm>
        </div>
      )}

      {(row.status === "aprobada" || row.status === "rechazada") && (
        <details className="border-t border-border pt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Cambiar la decisión</summary>
          <ActionForm
            action={row.status === "aprobada" ? rejectSale : approveSale}
            success={row.status === "aprobada" ? "Venta rechazada: el registro volvió a su estado" : "Venta aprobada: el registro quedó como convertido"}
            className="mt-2 flex items-center gap-1.5"
          >
            <input type="hidden" name="id" value={row.id} />
            <Input name="note" required placeholder="Por qué cambias la decisión" aria-label="Motivo del cambio" className="h-8 min-w-0 flex-1 text-xs" />
            <ActionSubmit variant={row.status === "aprobada" ? "danger" : "primary"} size="sm" pendingLabel="Guardando…">
              {row.status === "aprobada" ? "Rechazar" : "Aprobar"}
            </ActionSubmit>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}

export default async function ValidacionVentasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  noStore();
  await requireProfile(["supervisor", "admin"]);
  const { estado } = await searchParams;
  const status = TABS.find((tab) => tab.status === estado)?.status ?? "pendiente";

  let rows: SaleValidationRow[] = [];
  let counts: Record<SaleValidationStatus, number> = { pendiente: 0, aprobada: 0, rechazada: 0, anulada: 0 };
  let loadError: string | null = null;
  try {
    [rows, counts] = await Promise.all([listSaleValidations(status), countSaleValidations()]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron leer las ventas.";
  }

  const pendingUf = status === "pendiente" ? rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Validación de ventas"
        description="Las ventas que tipifican los ejecutivos esperan tu revisión. Al aprobarlas avanzan en el CRM (el registro queda como convertido); si las rechazas, no avanzan y el motivo queda registrado."
        className="border-b-0 pb-0"
      />

      <nav className="-mt-1 flex items-center gap-1 overflow-x-auto border-b border-border" aria-label="Estado de las ventas">
        {TABS.map((tab) => {
          const active = tab.status === status;
          return (
            <Link
              key={tab.status}
              href={tab.status === "pendiente" ? "/dashboard/validacion-ventas" : `/dashboard/validacion-ventas?estado=${tab.status}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="rounded bg-surface-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {counts[tab.status].toLocaleString("es-CL")}
              </span>
            </Link>
          );
        })}
      </nav>

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      {status === "pendiente" && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {`${rows.length.toLocaleString("es-CL")} ${rows.length === 1 ? "venta" : "ventas"} por validar · ${formatUf(pendingUf)} en juego. Las más antiguas primero.`}
        </p>
      )}

      {!loadError && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={BadgeCheck}
            title={status === "pendiente" ? "No hay ventas por validar" : "No hay ventas en este estado"}
            description={
              status === "pendiente"
                ? "Cuando un ejecutivo cierre una llamada como VENTA EN VALIDACION, aparecerá aquí."
                : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((row) => (
            <SaleCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
