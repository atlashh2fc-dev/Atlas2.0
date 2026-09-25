import { Search } from "lucide-react";
import type { SaleDateField, SaleValidationRow, SaleValidationStatus } from "@/app/actions/validacion-ventas";
import { Field, FilterBar, Input, Select } from "@/components/ui";

/**
 * Filtros de la validación de ventas, iguales en la cola y en el buscador de
 * ventas validadas: texto libre, ejecutivo, producto, período o rango de
 * fechas y orden. Viven en la URL, así que una vista se guarda y se comparte
 * como un enlace.
 *
 * El período es el de la venta: el mes en que se gestionó, que es donde suma
 * en el reporte. Una venta antigua que se carga o se aprueba hoy no cae en el
 * mes actual.
 */
export type SaleFilterParams = {
  q?: string;
  estado?: string;
  /** Mes de la venta, YYYY-MM. Manda sobre desde/hasta. */
  periodo?: string;
  /** Qué fecha filtra: la de la venta (por defecto) o la de la decisión. */
  fecha?: string;
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

export function resolveDateField(value: string | undefined): SaleDateField {
  return value === "decision" ? "decision" : "venta";
}

function todayChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

/** Primer y último día de un mes YYYY-MM, o del mes actual desplazado en `offset`. */
export function monthRange(month: string | null, offset = 0) {
  const [year, monthIndex] = (month ?? todayChile().slice(0, 7)).split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  const last = new Date(Date.UTC(year, monthIndex + offset, 0));
  return {
    periodo: first.toISOString().slice(0, 7),
    desde: first.toISOString().slice(0, 10),
    hasta: last.toISOString().slice(0, 10),
  };
}

/** El rango que piden los filtros: el período si hay uno válido, si no desde/hasta. */
export function resolveRange(params: SaleFilterParams) {
  if (params.periodo && /^\d{4}-\d{2}$/.test(params.periodo)) {
    const { periodo, desde, hasta } = monthRange(params.periodo);
    return { periodo, from: desde, to: hasta };
  }
  return { periodo: null, from: isoDate(params.desde), to: isoDate(params.hasta) };
}

const monthLabel = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });

/** Los últimos doce meses, del actual hacia atrás, para el selector de período. */
function periodOptions() {
  return Array.from({ length: 12 }, (_, index) => {
    const { periodo } = monthRange(null, -index);
    const label = monthLabel.format(new Date(`${periodo}-01T12:00:00Z`));
    return { value: periodo, label: label.charAt(0).toUpperCase() + label.slice(1) };
  });
}

/**
 * Ordena por la fecha que se está mirando: la de la venta, o la de la
 * decisión (si no hay decisión, la de la venta).
 */
export function sortSales(rows: SaleValidationRow[], orden: Orden, dateField: SaleDateField = "venta"): SaleValidationRow[] {
  const when = (row: SaleValidationRow) =>
    new Date(dateField === "decision" ? (row.decidedAt ?? row.soldAt) : row.soldAt).getTime();
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
  dateField,
  systemViews,
}: {
  params: SaleFilterParams;
  storageKey: string;
  agents: string[];
  products: string[];
  /** Nombre de la fecha del rango cuando no se puede elegir (la cola filtra por la venta). */
  dateLabel: string;
  orden: Orden;
  statusOptions?: { value: SaleValidationStatus; label: string }[];
  status?: SaleValidationStatus;
  /** Si se pasa, se puede elegir entre la fecha de la venta y la de la decisión. */
  dateField?: SaleDateField;
  systemViews?: { name: string; query: string }[];
}) {
  const { periodo } = resolveRange(params);
  // Con un período elegido, desde/hasta no aplican: se muestran vacíos.
  const from = periodo ? null : isoDate(params.desde);
  const to = periodo ? null : isoDate(params.hasta);
  const rangeLabel = dateField ? "Fecha" : dateLabel;
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
      <Field label="Período de la venta" className="w-44">
        <Select name="periodo" defaultValue={periodo ?? ""}>
          <option value="">Cualquiera</option>
          {periodOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      {dateField && (
        <Field label="El rango mira" className="w-40">
          <Select name="fecha" defaultValue={dateField}>
            <option value="venta">Fecha de venta</option>
            <option value="decision">Fecha de decisión</option>
          </Select>
        </Field>
      )}
      <Field label={`${rangeLabel} desde`} className="w-40">
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
