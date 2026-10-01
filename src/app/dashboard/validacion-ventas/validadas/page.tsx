import { connection } from "next/server";
import { BadgeCheck, Calculator, Coins, Users } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { searchSaleValidations, type SaleValidationRow, type SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { SaleValidationsTable } from "@/components/sale-validations-table";
import { formatUf } from "@/lib/sale-validation-format";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Avatar, Callout, SectionCard } from "@/components/ui";
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
  await connection();
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

  const maxUf = Math.max(0, ...byAgent.map(([, totals]) => totals.uf));

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

      <KpiStrip columns={4}>
        <KpiStripItem
          label={`Ventas ${estadoLabel}`}
          value={rows.length.toLocaleString("es-CL")}
          icon={BadgeCheck}
          detail={
            range.periodo
              ? "Vendidas en el período, aunque se hayan cargado o aprobado después"
              : filtered
                ? "Con los filtros aplicados"
                : "Todo el historial"
          }
        />
        <KpiStripItem label="UF mensual" value={formatUf(totalUf)} icon={Coins} detail="Suma de las ventas encontradas" />
        <KpiStripItem label="UF promedio por venta" value={formatUf(rows.length ? totalUf / rows.length : null)} icon={Calculator} />
        <KpiStripItem
          label="Ejecutivos"
          value={byAgent.length.toLocaleString("es-CL")}
          icon={Users}
          detail={byAgent[0] ? `Lidera ${byAgent[0][0]}` : undefined}
        />
      </KpiStrip>

      {byAgent.length > 1 && (
        <SectionCard title="Por ejecutivo" description="Ventas y UF de lo encontrado, de mayor a menor.">
          {/* Ranking compacto: avatar, barra de UF contra el líder y las cifras. */}
          <ol className="grid border-t border-border sm:grid-cols-2 xl:grid-cols-3">
            {byAgent.map(([name, totals], index) => (
              <li key={name} className="flex items-center gap-3 border-b border-border/70 px-5 py-2.5">
                <span className="w-4 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                <Avatar name={name} size="sm" tone={name === "Sin ejecutivo" ? "slate" : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground" title={name}>{name}</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${maxUf > 0 ? (totals.uf / maxUf) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold tabular-nums text-foreground">{formatUf(totals.uf)}</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {totals.ventas} {totals.ventas === 1 ? "venta" : "ventas"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      <SaleValidationsTable rows={rows} mode="buscador" exportFilename={`ventas-${status}s`} />
    </div>
  );
}
