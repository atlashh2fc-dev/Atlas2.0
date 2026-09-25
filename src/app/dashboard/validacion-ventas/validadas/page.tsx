import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { searchSaleValidations, type SaleValidationRow, type SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { SaleValidationsTable } from "@/components/sale-validations-table";
import { formatUf } from "@/lib/sale-validation-format";
import { Callout, MetricCard, SectionCard } from "@/components/ui";
import { ValidacionVentasHeader } from "../header";
import {
  SaleFilters,
  filterOptions,
  monthRange,
  resolveDateField,
  resolveOrden,
  resolveRange,
  sortSales,
  type SaleFilterParams,
} from "../filters";

/**
 * Buscador propio del universo de ventas ya decididas: por empresa, RUT,
 * teléfono, ejecutivo o producto, por período o rango de fechas (hora Chile).
 * Por defecto las fechas son las de la venta —el período en que suma en el
 * reporte—, así que una venta de abril aprobada hoy no cuenta en el mes
 * actual; también se puede mirar la fecha de la decisión. Muestra las
 * aprobadas; también encuentra rechazadas y anuladas. Exporta lo filtrado o lo
 * seleccionado.
 */
const ESTADOS: { value: SaleValidationStatus; label: string }[] = [
  { value: "aprobada", label: "Aprobadas" },
  { value: "rechazada", label: "Rechazadas" },
  { value: "anulada", label: "Anuladas" },
];

function sumUf(rows: SaleValidationRow[]) {
  return rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0);
}

export default async function VentasValidadasPage({ searchParams }: { searchParams: Promise<SaleFilterParams> }) {
  noStore();
  await requireProfile(["supervisor", "admin"]);
  const params = await searchParams;
  const status = ESTADOS.find((estado) => estado.value === params.estado)?.value ?? "aprobada";
  const orden = resolveOrden(params.orden, "recientes");
  const range = resolveRange(params);
  // El período siempre es el de la venta; el selector de fecha solo cambia el rango.
  const dateField = range.periodo ? "venta" : resolveDateField(params.fecha);
  const filters = {
    status,
    query: params.q?.trim() || null,
    from: range.from,
    to: range.to,
    agent: params.ejecutivo || null,
    product: params.producto || null,
    dateField,
  };
  const filtered = Boolean(filters.query || filters.from || filters.to || filters.agent || filters.product);

  let found: SaleValidationRow[] = [];
  let universe: SaleValidationRow[] = [];
  let loadError: string | null = null;
  try {
    // El universo del estado alimenta las listas de ejecutivos y productos;
    // sin filtros es la misma consulta.
    [found, universe] = await Promise.all([
      searchSaleValidations(filters),
      filtered ? searchSaleValidations({ status }) : Promise.resolve<SaleValidationRow[]>([]),
    ]);
    if (!filtered) universe = found;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron buscar las ventas.";
  }

  const rows = sortSales(found, orden, dateField);
  const { agents, products } = filterOptions(universe);

  const totalUf = sumUf(rows);
  const byAgent = [...rows.reduce((map, row) => {
    const key = row.agentName ?? "Sin ejecutivo";
    const current = map.get(key) ?? { ventas: 0, uf: 0 };
    map.set(key, { ventas: current.ventas + 1, uf: current.uf + (row.ufAmount ?? 0) });
    return map;
  }, new Map<string, { ventas: number; uf: number }>())].sort((a, b) => b[1].uf - a[1].uf || b[1].ventas - a[1].ventas);

  const thisMonth = monthRange(null);
  const lastMonth = monthRange(null, -1);
  const estadoLabel = ESTADOS.find((estado) => estado.value === status)!.label.toLowerCase();

  return (
    <div className="space-y-5">
      <ValidacionVentasHeader />

      <SaleFilters
        params={params}
        storageKey="ventas-validadas"
        agents={agents}
        products={products}
        dateLabel="Vendida"
        orden={orden}
        statusOptions={ESTADOS}
        status={status}
        dateField={dateField}
        systemViews={[
          { name: "Ventas de este mes", query: `periodo=${thisMonth.periodo}` },
          { name: "Ventas del mes anterior", query: `periodo=${lastMonth.periodo}` },
          { name: "Decididas este mes", query: `fecha=decision&desde=${thisMonth.desde}&hasta=${thisMonth.hasta}` },
          { name: "Rechazadas", query: "estado=rechazada" },
        ]}
      />

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={`Ventas ${estadoLabel}`}
          value={rows.length.toLocaleString("es-CL")}
          hint={
            range.periodo
              ? "Vendidas en el período, aunque se hayan cargado o aprobado después"
              : filtered
                ? "Con los filtros aplicados"
                : "Todo el historial"
          }
        />
        <MetricCard label="UF mensual" value={formatUf(totalUf)} hint="Suma de las ventas encontradas" />
        <MetricCard label="UF promedio por venta" value={formatUf(rows.length ? totalUf / rows.length : null)} />
        <MetricCard
          label="Ejecutivos"
          value={byAgent.length.toLocaleString("es-CL")}
          hint={byAgent[0] ? `Lidera ${byAgent[0][0]}` : undefined}
        />
      </section>

      {byAgent.length > 1 && (
        <SectionCard title="Por ejecutivo" description="Ventas y UF de lo encontrado, de mayor a menor.">
          <ul className="grid gap-x-6 gap-y-1 px-4 py-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {byAgent.map(([name, totals]) => (
              <li key={name} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
                <span className="truncate">{name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {totals.ventas} · <span className="font-medium text-foreground">{formatUf(totals.uf)}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SaleValidationsTable rows={rows} mode="buscador" exportFilename={`ventas-${status}s`} />
    </div>
  );
}
