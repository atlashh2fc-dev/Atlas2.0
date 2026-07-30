"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Columns3,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistentState } from "@/lib/persistent-state";
import { buttonClasses, type ButtonVariant } from "./button";
import { InfoTooltip } from "./info-tooltip";
import { LoadingState } from "./loading-state";
import { metricDefinition, type MetricId } from "@/lib/metric-definitions";

export type CellValue = string | number | null | undefined;

export type Column<T> = {
  id: string;
  header: ReactNode;
  /** Valor plano: se usa para ordenar y exportar. */
  value?: (row: T) => CellValue;
  /** Contenido de la celda. Si falta, se muestra `value`. */
  cell?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Por defecto, ordenable si tiene `value`. */
  sortable?: boolean;
  /** Definición del glosario que se muestra en el encabezado. */
  metric?: MetricId;
  tooltip?: string;
  className?: string;
};

export type BulkAction<T> = {
  id: string;
  label: string;
  variant?: ButtonVariant;
  onAction: (rows: T[]) => void | Promise<void>;
};

type SortState = { id: string; dir: "asc" | "desc" } | null;

const PAGE_SIZES = [25, 50, 100, 250];
const NO_HIDDEN: string[] = [];

function compare(a: CellValue, b: CellValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true });
}

/**
 * Tabla de datos única del producto: orden por columna, paginación con conteo
 * real, selección múltiple con acciones masivas, columnas configurables,
 * densidad, exportación y los tres estados (cargando, vacío, error).
 *
 * Regla que hace cumplir: **ninguna tabla corta filas sin decirlo**
 * (docs/auditoria-vistas-workplace.md §6).
 *
 * Paginación en cliente por defecto. Si se entrega `onPageChange`, las filas
 * recibidas se tratan como la página actual y la paginación pasa al servidor.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  rowHref,
  selectable = false,
  bulkActions,
  toolbar,
  storageKey,
  exportFilename,
  emptyTitle = "Sin resultados",
  emptyDescription,
  emptyAction,
  loading = false,
  loadingLabel = "Actualizando resultados",
  error,
  onRetry,
  page: serverPage,
  pageCount: serverPageCount,
  total: serverTotal,
  serverPageSize,
  onPageChange,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  rowHref?: (row: T) => string;
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];
  toolbar?: ReactNode;
  storageKey?: string;
  exportFilename?: string;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  loading?: boolean;
  /** Texto que explica qué información se está consultando mientras se muestra el skeleton. */
  loadingLabel?: string;
  error?: string | null;
  onRetry?: () => void;
  page?: number;
  pageCount?: number;
  total?: number;
  /** Tamaño de página real cuando la paginación la resuelve el servidor. */
  serverPageSize?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}) {
  const router = useRouter();
  const serverMode = typeof onPageChange === "function";

  const [sort, setSort] = useState<SortState>(null);
  const [clientPage, setClientPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [showColumns, setShowColumns] = useState(false);

  const [pageSize, setPageSize] = usePersistentState<number>(
    `atlas.table.${storageKey ?? "default"}.pageSize`,
    50
  );
  const [compact, setCompact] = usePersistentState<boolean>(`atlas.table.${storageKey ?? "default"}.compact`, false);
  const [hidden, setHidden] = usePersistentState<string[]>(
    `atlas.table.${storageKey ?? "default"}.hidden`,
    NO_HIDDEN
  );

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.includes(column.id)),
    [columns, hidden]
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column?.value) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(column.value!(a), column.value!(b)));
  }, [rows, sort, columns]);

  const total = serverMode ? serverTotal ?? rows.length : sortedRows.length;
  const pageCount = serverMode ? serverPageCount ?? 1 : Math.max(1, Math.ceil(total / pageSize));
  const page = serverMode ? serverPage ?? 1 : Math.min(clientPage, pageCount);
  const pageRows = serverMode ? sortedRows : sortedRows.slice((page - 1) * pageSize, page * pageSize);

  // En modo servidor manda el tamaño real de página que informa quien consulta;
  // deducirlo de total/páginas daba rangos corridos (46–95 en vez de 51–100).
  const effectivePageSize = serverMode
    ? serverPageSize ?? Math.max(1, Math.ceil(total / Math.max(1, pageCount)))
    : pageSize;
  const firstShown = total === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const lastShown = total === 0 ? 0 : Math.min(total, firstShown + pageRows.length - 1);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.includes(getRowId(row))),
    [rows, selected, getRowId]
  );
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.includes(getRowId(row)));

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), pageCount);
    if (serverMode) onPageChange!(clamped);
    else setClientPage(clamped);
  };

  // Con paginación de servidor solo tenemos la página actual en memoria:
  // ordenar acá daría la ilusión de haber ordenado el total.
  const canSortColumns = !serverMode;

  const toggleSort = (column: Column<T>) => {
    if (!canSortColumns || !column.value || column.sortable === false) return;
    setSort((current) =>
      current?.id !== column.id
        ? { id: column.id, dir: "asc" }
        : current.dir === "asc"
          ? { id: column.id, dir: "desc" }
          : null
    );
  };

  const exportRows = async () => {
    const source = selectedRows.length > 0 ? selectedRows : sortedRows;
    const data = source.map((row) => {
      const record: Record<string, CellValue> = {};
      for (const column of visibleColumns) {
        if (!column.value) continue;
        const header = typeof column.header === "string" ? column.header : column.metric ? metricDefinition(column.metric).label : column.id;
        record[header] = column.value(row);
      }
      return record;
    });
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.length > 0 ? data : [{}]), "Datos");
    XLSX.writeFile(workbook, `${exportFilename ?? storageKey ?? "datos"}.xlsx`);
  };

  const columnSpan = visibleColumns.length + (selectable ? 1 : 0);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}

        <div className="ml-auto flex items-center gap-2">
          {storageKey && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColumns((current) => !current)}
                aria-expanded={showColumns}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                <Columns3 size={14} aria-hidden="true" />
                Columnas
                <ChevronDown size={13} aria-hidden="true" />
              </button>

              {showColumns && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg">
                  {columns.map((column) => (
                    <label
                      key={column.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-surface-muted"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={!hidden.includes(column.id)}
                        onChange={() =>
                          setHidden((current) =>
                            current.includes(column.id)
                              ? current.filter((id) => id !== column.id)
                              : [...current, column.id]
                          )
                        }
                      />
                      {typeof column.header === "string"
                        ? column.header
                        : column.metric
                          ? metricDefinition(column.metric).label
                          : column.id}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setCompact((current) => !current)}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            title={compact ? "Ver en densidad cómoda" : "Ver en densidad compacta"}
          >
            {compact ? "Cómoda" : "Compacta"}
          </button>

          <button
            type="button"
            onClick={exportRows}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            title={
              selectedRows.length > 0
                ? "Exportar la selección"
                : serverMode
                  ? "Exportar la página actual"
                  : "Exportar todas las filas de esta vista"
            }
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            Exportar
          </button>
        </div>
      </div>

      {selectable && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
          <span className="text-sm font-medium text-foreground">
            {selected.length} {selected.length === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Quitar selección
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions?.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => action.onAction(selectedRows)}
                className={buttonClasses({ variant: action.variant ?? "secondary", size: "sm" })}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {loading && (
          <div className="border-b border-border bg-surface-muted/40 px-4 py-2.5">
            <LoadingState label={loadingLabel} compact />
          </div>
        )}
        <table
          className={cn(
            "w-full border-collapse text-sm tabular-nums",
            compact && "text-xs [&_td]:py-1 [&_th]:py-1.5"
          )}
        >
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              {selectable && (
                <th className="w-9 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las filas de la página"
                    className="accent-primary"
                    checked={allOnPageSelected}
                    onChange={() =>
                      setSelected((current) => {
                        const ids = pageRows.map(getRowId);
                        return allOnPageSelected
                          ? current.filter((id) => !ids.includes(id))
                          : [...new Set([...current, ...ids])];
                      })
                    }
                  />
                </th>
              )}

              {visibleColumns.map((column) => {
                const definition = column.metric ? metricDefinition(column.metric) : null;
                const canSort = canSortColumns && Boolean(column.value) && column.sortable !== false;
                const active = sort?.id === column.id;
                const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ChevronUp : ChevronDown;

                return (
                  <th
                    key={column.id}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "px-4 py-2.5 font-semibold",
                      column.align === "right" && "text-right",
                      column.className
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        column.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
                        >
                          {column.header ?? definition?.label}
                          <Icon size={12} className={active ? "text-foreground" : "text-muted-foreground/60"} />
                        </button>
                      ) : (
                        <>{column.header ?? definition?.label}</>
                      )}
                      {(column.tooltip || definition) && (
                        <InfoTooltip
                          text={column.tooltip ?? definition!.definition}
                          formula={definition?.formula}
                          align={column.align === "right" ? "right" : "left"}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {loading &&
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton-${index}`}>
                  <td colSpan={columnSpan} className="px-4 py-2.5">
                    <span className="block h-4 w-full animate-pulse rounded bg-surface-muted" />
                  </td>
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan={columnSpan} className="px-5 py-8 text-center">
                  <p className="text-sm text-danger">{error}</p>
                  {onRetry && (
                    <button type="button" onClick={onRetry} className={cn(buttonClasses({ variant: "secondary", size: "sm" }), "mt-3")}>
                      <RefreshCw size={14} aria-hidden="true" />
                      Reintentar
                    </button>
                  )}
                </td>
              </tr>
            )}

            {!loading && !error && pageRows.length === 0 && (
              <tr>
                <td colSpan={columnSpan} className="px-5 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                  {emptyDescription && <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>}
                  {emptyAction && <div className="mt-3 flex justify-center">{emptyAction}</div>}
                </td>
              </tr>
            )}

            {!loading &&
              !error &&
              pageRows.map((row) => {
                const id = getRowId(row);
                const href = rowHref?.(row);

                return (
                  <tr
                    key={id}
                    onClick={href ? () => router.push(href) : undefined}
                    className={cn(
                      "transition-colors hover:bg-surface-muted/50",
                      href && "cursor-pointer",
                      selected.includes(id) && "bg-primary/[0.05]"
                    )}
                  >
                    {selectable && (
                      <td className="w-9 px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar fila"
                          className="accent-primary"
                          checked={selected.includes(id)}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
                            )
                          }
                        />
                      </td>
                    )}

                    {visibleColumns.map((column, index) => {
                      const content = column.cell ? column.cell(row) : column.value?.(row) ?? "—";
                      return (
                        <td
                          key={column.id}
                          className={cn(
                            "px-4 py-2.5",
                            column.align === "right" && "text-right",
                            column.className
                          )}
                        >
                          {index === 0 && href ? (
                            // La fila completa ya navega; el enlace existe para
                            // teclado y lectores de pantalla, así que no debe
                            // disparar además el clic de la fila.
                            <Link
                              href={href}
                              onClick={(event) => event.stopPropagation()}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total === 0 ? "Sin filas" : `${firstShown}–${lastShown} de ${total.toLocaleString("es-CL")}`}
        </span>

        {!serverMode && (
          <label className="flex items-center gap-1.5">
            Filas por página
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setClientPage(1);
              }}
              className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}

        {pageCount > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label="Página anterior"
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="tabular-nums">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= pageCount}
              aria-label="Página siguiente"
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
