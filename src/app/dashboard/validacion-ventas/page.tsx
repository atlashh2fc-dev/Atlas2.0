import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { listSaleValidations, searchSaleValidations, type SaleValidationRow } from "@/app/actions/validacion-ventas";
import { SaleValidationsTable } from "@/components/sale-validations-table";
import { formatUf } from "@/lib/sale-validation-format";
import { Callout, MetricCard } from "@/components/ui";
import { ValidacionVentasHeader } from "./header";
import { SaleFilters, filterOptions, isoDate, resolveOrden, sortSales, type SaleFilterParams } from "./filters";

/**
 * Cola de validación de ventas. En Atlas 1 la trabajaba un backoffice; en
 * Geimser la trabaja la supervisora del equipo. Aprobar deja el registro como
 * convertido; rechazar exige motivo y no lo avanza. Se busca y se ordena igual
 * que en «Ventas validadas»; el rango de fechas es sobre la fecha de la venta.
 * Las RPC vuelven a validar rol, empresa y equipo.
 */
function todayChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

function daysAgo(days: number): string {
  const date = new Date(`${todayChile()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function sumUf(rows: SaleValidationRow[]) {
  return rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0);
}

export default async function ValidacionVentasPage({ searchParams }: { searchParams: Promise<SaleFilterParams> }) {
  noStore();
  await requireProfile(["supervisor", "admin"]);
  const params = await searchParams;
  const orden = resolveOrden(params.orden, "antiguas");
  const filters = {
    status: "pendiente" as const,
    query: params.q?.trim() || null,
    from: isoDate(params.desde),
    to: isoDate(params.hasta),
    agent: params.ejecutivo || null,
    product: params.producto || null,
  };
  const filtered = Boolean(filters.query || filters.from || filters.to || filters.agent || filters.product);

  let pending: SaleValidationRow[] = [];
  let found: SaleValidationRow[] = [];
  let approvedThisMonth: SaleValidationRow[] = [];
  let loadError: string | null = null;
  try {
    [pending, found, approvedThisMonth] = await Promise.all([
      listSaleValidations("pendiente"),
      filtered ? searchSaleValidations(filters) : Promise.resolve<SaleValidationRow[]>([]),
      searchSaleValidations({ status: "aprobada", from: `${todayChile().slice(0, 7)}-01` }),
    ]);
    if (!filtered) found = pending;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron leer las ventas.";
  }

  const rows = sortSales(found, orden);
  const { agents, products } = filterOptions(pending);

  // Los indicadores miran toda la cola; la tabla, lo que dejan los filtros.
  const nowMs = new Date().getTime();
  const oldest = pending.reduce<string | null>((min, row) => (!min || row.soldAt < min ? row.soldAt : min), null);
  const oldestDays = oldest ? Math.floor((nowMs - new Date(oldest).getTime()) / 86_400_000) : 0;
  const overdue = pending.filter((row) => nowMs - new Date(row.soldAt).getTime() > 7 * 86_400_000).length;

  return (
    <div className="space-y-5">
      <ValidacionVentasHeader />

      <SaleFilters
        params={params}
        storageKey="validacion-ventas-cola"
        agents={agents}
        products={products}
        dateLabel="Tipificada"
        orden={orden}
        systemViews={[
          { name: "Atrasadas (más de 7 días)", query: `hasta=${daysAgo(8)}` },
          { name: "De esta semana", query: `desde=${daysAgo(6)}&orden=recientes` },
          { name: "Mayor UF primero", query: "orden=uf" },
        ]}
      />

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Por validar" value={pending.length.toLocaleString("es-CL")} hint="Ventas esperando tu decisión" />
        <MetricCard label="UF en juego" value={formatUf(sumUf(pending))} hint="Suma mensual de lo pendiente" />
        <MetricCard
          label="Esperando más de 7 días"
          value={overdue.toLocaleString("es-CL")}
          hint={oldest ? `La más antigua, hace ${oldestDays} días` : "Nada atrasado"}
          tone={overdue > 0 ? "danger" : "good"}
          href={overdue > 0 ? `/dashboard/validacion-ventas?hasta=${daysAgo(8)}` : undefined}
          hrefLabel="Ver atrasadas"
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
        {filtered
          ? `${rows.length.toLocaleString("es-CL")} de ${pending.length.toLocaleString("es-CL")} por validar con estos filtros · ${formatUf(sumUf(rows))}. `
          : ""}
        Marca varias para aprobarlas o rechazarlas de una vez. Toca la empresa para ver el detalle; también puedes ordenar
        tocando el título de cada columna.
      </p>

      <SaleValidationsTable rows={rows} mode="cola" exportFilename="ventas-por-validar" />
    </div>
  );
}
