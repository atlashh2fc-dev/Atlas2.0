import { Search } from "lucide-react";
import type { SaleValidationRow, SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { Field, FilterBar, Input, Select } from "@/components/ui";

/**
 * Filtros de la validación de ventas, iguales en la cola y en el buscador de
 * ventas validadas: texto libre, ejecutivo, producto, rango de fechas y orden.
 * Viven en la URL, así que una vista se guarda y se comparte como un enlace.
 */
export type SaleFilterParams = {
  q?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
  ejecutivo?: string;
  producto?: string;
  orden?: string;
};

export const ORDENES = {
  antiguas: "Más antiguas primero",
  recientes: "Más recientes primero",
  uf: "Mayor UF primero",
  ejecutivo: "Ejecutivo (A-Z)",
  empresa: "Empresa (A-Z)",
} as const;
export type Orden = keyof typeof ORDENES;

export function isoDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function resolveOrden(value: string | undefined, fallback: Orden): Orden {
  return value && value in ORDENES ? (value as Orden) : fallback;
}

/** Ordena por la fecha que corresponde: la de la decisión si existe, si no la de la venta. */
export function sortSales(rows: SaleValidationRow[], orden: Orden): SaleValidationRow[] {
  const when = (row: SaleValidationRow) => new Date(row.decidedAt ?? row.soldAt).getTime();
  const text = (value: string | null) => value ?? "￿";
  return [...rows].sort((a, b) => {
    switch (orden) {
      case "antiguas":
        return when(a) - when(b);
      case "recientes":
        return when(b) - when(a);
      case "uf":
        return (b.ufAmount ?? -1) - (a.ufAmount ?? -1) || when(a) - when(b);
      case "ejecutivo":
        return text(a.agentName).localeCompare(text(b.agentName), "es") || when(a) - when(b);
      case "empresa":
        return text(a.leadName).localeCompare(text(b.leadName), "es") || when(a) - when(b);
    }
  });
}

/** Ejecutivos y productos presentes en el universo, para las listas de los filtros. */
export function filterOptions(universe: SaleValidationRow[]) {
  const agents = [...new Set(universe.map((row) => row.agentName).filter((name): name is string => Boolean(name)))];
  const products = [...new Set(universe.flatMap((row) => row.products))];
  return {
    agents: agents.sort((a, b) => a.localeCompare(b, "es")),
    products: products.sort((a, b) => a.localeCompare(b, "es")),
  };
}

export function SaleFilters({
  params,
  storageKey,
  agents,
  products,
  dateLabel,
  orden,
  statusOptions,
  status,
  systemViews,
}: {
  params: SaleFilterParams;
  storageKey: string;
  agents: string[];
  products: string[];
  /** Qué fecha filtra el rango: la de la venta (cola) o la de la decisión (buscador). */
  dateLabel: string;
  orden: Orden;
  statusOptions?: { value: SaleValidationStatus; label: string }[];
  status?: SaleValidationStatus;
  systemViews?: { name: string; query: string }[];
}) {
  const from = isoDate(params.desde);
  const to = isoDate(params.hasta);
  return (
    <FilterBar storageKey={storageKey} applyLabel="Buscar" systemViews={systemViews}>
      <Field label="Buscar" className="min-w-64 flex-1">
        <span className="relative block">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={params.q ?? ""} placeholder="Empresa, RUT, teléfono, ejecutivo o producto" className="pl-8" />
        </span>
      </Field>
      {statusOptions && (
        <Field label="Estado" className="w-36">
          <Select name="estado" defaultValue={status}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
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
      <Field label={`${dateLabel} desde`} className="w-40">
        <Input name="desde" type="date" defaultValue={from ?? ""} max={to ?? undefined} />
      </Field>
      <Field label="Hasta" className="w-40">
        <Input name="hasta" type="date" defaultValue={to ?? ""} min={from ?? undefined} />
      </Field>
      <Field label="Ordenar" className="w-48">
        <Select name="orden" defaultValue={orden}>
          {Object.entries(ORDENES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
    </FilterBar>
  );
}
