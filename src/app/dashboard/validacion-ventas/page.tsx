import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { listSaleValidations, searchSaleValidations, type SaleValidationRow } from "@/app/actions/validacion-ventas";
import { SaleValidationsTable } from "@/components/sale-validations-table";
import { formatUf } from "@/lib/sale-validation-format";
import { Callout, MetricCard } from "@/components/ui";
import { ValidacionVentasHeader } from "./header";

/**
 * Cola de validación de ventas. En Atlas 1 la trabajaba un backoffice; en
 * Geimser la trabaja la supervisora del equipo. Aprobar deja el registro como
 * convertido; rechazar exige motivo y no lo avanza. Las RPC vuelven a validar
 * rol, empresa y equipo.
 */
function startOfMonthChile(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  return `${today.slice(0, 7)}-01`;
}

function sumUf(rows: SaleValidationRow[]) {
  return rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0);
}

export default async function ValidacionVentasPage() {
  noStore();
  await requireProfile(["supervisor", "admin"]);

  let pending: SaleValidationRow[] = [];
  let approvedThisMonth: SaleValidationRow[] = [];
  let loadError: string | null = null;
  try {
    [pending, approvedThisMonth] = await Promise.all([
      listSaleValidations("pendiente"),
      searchSaleValidations({ status: "aprobada", from: startOfMonthChile() }),
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron leer las ventas.";
  }

  const nowMs = new Date().getTime();
  const oldest = pending.reduce<string | null>((min, row) => (!min || row.soldAt < min ? row.soldAt : min), null);
  const oldestDays = oldest ? Math.floor((nowMs - new Date(oldest).getTime()) / 86_400_000) : 0;
  const overdue = pending.filter((row) => nowMs - new Date(row.soldAt).getTime() > 7 * 86_400_000).length;

  return (
    <div className="space-y-5">
      <ValidacionVentasHeader />

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Por validar" value={pending.length.toLocaleString("es-CL")} hint="Ventas esperando tu decisión" />
        <MetricCard label="UF en juego" value={formatUf(sumUf(pending))} hint="Suma mensual de lo pendiente" />
        <MetricCard
          label="Esperando más de 7 días"
          value={overdue.toLocaleString("es-CL")}
          hint={oldest ? `La más antigua, hace ${oldestDays} días` : "Nada atrasado"}
          tone={overdue > 0 ? "danger" : "good"}
        />
        <MetricCard
          label="Aprobadas este mes"
          value={approvedThisMonth.length.toLocaleString("es-CL")}
          hint={formatUf(sumUf(approvedThisMonth))}
          href="/dashboard/validacion-ventas/validadas"
          hrefLabel="Buscar ventas validadas"
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Marca varias y apruébalas o recházalas de una vez, o decide fila por fila. Toca la empresa para ver el detalle
        completo. Las más antiguas van primero.
      </p>

      <SaleValidationsTable rows={pending} mode="cola" exportFilename="ventas-por-validar" />
    </div>
  );
}
