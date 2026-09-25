import { unstable_noStore as noStore } from "next/cache";
import { Search } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { searchSaleValidations, type SaleValidationRow, type SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { SaleValidationsTable } from "@/components/sale-validations-table";
import { formatUf } from "@/lib/sale-validation-format";
import { Callout, Field, FilterBar, Input, MetricCard, SectionCard, Select } from "@/components/ui";
import { ValidacionVentasHeader } from "../header";

/**
 * Buscador propio del universo de ventas ya decididas: por empresa, RUT,
 * teléfono, ejecutivo o producto, con rango de fechas de la decisión (hora
 * Chile). Por defecto muestra las aprobadas; también encuentra rechazadas y
 * anuladas. Exporta lo filtrado o lo seleccionado.
 */
const ESTADOS: { value: SaleValidationStatus; label: string }[] = [
  { value: "aprobada", label: "Aprobadas" },
  { value: "rechazada", label: "Rechazadas" },
  { value: "anulada", label: "Anuladas" },
];

type Params = { q?: string; estado?: string; desde?: string; hasta?: string; ejecutivo?: string; producto?: string };

function isoDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function monthRange(offset: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { desde: first.toISOString().slice(0, 10), hasta: last.toISOString().slice(0, 10) };
}

function sumUf(rows: SaleValidationRow[]) {
  return rows.reduce((sum, row) => sum + (row.ufAmount ?? 0), 0);
}

export default async function VentasValidadasPage({ searchParams }: { searchParams: Promise<Params> }) {
  noStore();
  await requireProfile(["supervisor", "admin"]);
  const params = await searchParams;
  const status = ESTADOS.find((estado) => estado.value === params.estado)?.value ?? "aprobada";
  const filters = {
    status,
    query: params.q?.trim() || null,
    from: isoDate(params.desde),
    to: isoDate(params.hasta),
    agent: params.ejecutivo || null,
    product: params.producto || null,
  };
  const filtered = Boolean(filters.query || filters.from || filters.to || filters.agent || filters.product);

  let rows: SaleValidationRow[] = [];
  let universe: SaleValidationRow[] = [];
  let loadError: string | null = null;
  try {
    // El universo del estado alimenta las listas de ejecutivos y productos;
    // sin filtros es la misma consulta.
    [rows, universe] = await Promise.all([
      searchSaleValidations(filters),
      filtered ? searchSaleValidations({ status }) : Promise.resolve<SaleValidationRow[]>([]),
    ]);
    if (!filtered) universe = rows;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudieron buscar las ventas.";
  }

  const agents = [...new Set(universe.map((row) => row.agentName).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  const products = [...new Set(universe.flatMap((row) => row.products))].sort((a, b) => a.localeCompare(b, "es"));

  const totalUf = sumUf(rows);
  const byAgent = [...rows.reduce((map, row) => {
    const key = row.agentName ?? "Sin ejecutivo";
    const current = map.get(key) ?? { ventas: 0, uf: 0 };
    map.set(key, { ventas: current.ventas + 1, uf: current.uf + (row.ufAmount ?? 0) });
    return map;
  }, new Map<string, { ventas: number; uf: number }>())].sort((a, b) => b[1].uf - a[1].uf || b[1].ventas - a[1].ventas);

  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);
  const estadoLabel = ESTADOS.find((estado) => estado.value === status)!.label.toLowerCase();

  return (
    <div className="space-y-5">
      <ValidacionVentasHeader />

      <FilterBar
        storageKey="ventas-validadas"
        applyLabel="Buscar"
        systemViews={[
          { name: "Aprobadas este mes", query: `desde=${thisMonth.desde}&hasta=${thisMonth.hasta}` },
          { name: "Aprobadas mes anterior", query: `desde=${lastMonth.desde}&hasta=${lastMonth.hasta}` },
          { name: "Rechazadas", query: "estado=rechazada" },
        ]}
      >
        <Field label="Buscar" className="min-w-64 flex-1">
          <span className="relative block">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Empresa, RUT, teléfono, ejecutivo o producto"
              className="pl-8"
            />
          </span>
        </Field>
        <Field label="Estado" className="w-36">
          <Select name="estado" defaultValue={status}>
            {ESTADOS.map((estado) => (
              <option key={estado.value} value={estado.value}>
                {estado.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ejecutivo" className="w-52">
          <Select name="ejecutivo" defaultValue={params.ejecutivo ?? ""}>
            <option value="">Todos</option>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Producto" className="w-48">
          <Select name="producto" defaultValue={params.producto ?? ""}>
            <option value="">Todos</option>
            {products.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Decidida desde" className="w-40">
          <Input name="desde" type="date" defaultValue={filters.from ?? ""} max={filters.to ?? undefined} />
        </Field>
        <Field label="Hasta" className="w-40">
          <Input name="hasta" type="date" defaultValue={filters.to ?? ""} min={filters.from ?? undefined} />
        </Field>
      </FilterBar>

      {loadError && <Callout tone="danger">{loadError}</Callout>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={`Ventas ${estadoLabel}`} value={rows.length.toLocaleString("es-CL")} hint={filtered ? "Con los filtros aplicados" : "Todo el historial"} />
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
