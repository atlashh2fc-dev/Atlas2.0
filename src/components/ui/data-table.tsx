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
  Inbox,
  RefreshCw,
  Rows3,
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
  /** Desglosa una columna visual agrupada sin cambiar el formato del Excel. */
  exportValues?: (row: T) => Record<string, CellValue>;
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

export function tableExportRecord<T>(row: T, columns: Column<T>[]): Record<string, CellValue> {
  const record: Record<string, CellValue> = {};
  for (const column of columns) {
    if (column.exportValues) {
      Object.assign(record, column.exportValues(row));
    } else if (column.value) {
      const header = typeof column.header === "string" ? column.header : column.metric ? metricDefinition(column.metric).label : column.id;
      record[header] = column.value(row);
    }
  }
  return record;
}

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
  rowActionLabel,
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
  fitToWidth = false,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  rowHref?: (row: T) => string;
  /** Texto de la acción de cada fila ("Gestionar", "Revisar"); aparece al pasar el mouse. */
  rowActionLabel?: (row: T) => string;
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];
  /** Va dentro de la tarjeta, a la izquierda: vistas, búsqueda rápida. */
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
  /** Distribuye todas las columnas dentro del ancho disponible, sin scroll horizontal. */
  fitToWidth?: boolean;
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
    const data = source.map((row) => tableExportRecord(row, visibleColumns));
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.length > 0 ? data : [{}]), "Datos");
    XLSX.writeFile(workbook, `${exportFilename ?? storageKey ?? "datos"}.xlsx`);
  };

  // Una tabla que ya trae su propia acción por fila (Llamar, Abrir chat) no
  // suma otra: dos botones por fila es lo que volvía todo una planilla.
  const showRowAction = Boolean(rowHref) && !columns.some((column) => column.id === "accion");
  const columnSpan = visibleColumns.length + (selectable ? 1 : 0) + (showRowAction ? 1 : 0);
  const cellPadding = fitToWidth ? "min-w-0 break-words px-2 py-2 align-middle" : compact ? "px-3 py-1.5" : "px-3 py-3";

  return (
    <div className={cn("atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm", className)}>
      {/* Barra de la tabla: vistas o filtros rápidos a la izquierda, ajustes
          de la tabla a la derecha. Vive dentro de la tarjeta, no encima. */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-2 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center">{toolbar}</div>

        <div className="ml-auto flex items-center gap-0.5 py-1.5">
          {storageKey && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColumns((current) => !current)}
                aria-expanded={showColumns}
                title="Elegir columnas"
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                <Columns3 size={14} aria-hidden="true" />
                <span className="hidden xl:inline">Columnas</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>

              {showColumns && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-lg">
                  {columns.map((column) => (
                    <label
                      key={column.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-surface-muted"
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
            aria-pressed={compact}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
            title={compact ? "Ver en densidad cómoda" : "Ver en densidad compacta"}
          >
            <Rows3 size={14} aria-hidden="true" />
            <span className="hidden xl:inline">{compact ? "Cómoda" : "Compacta"}</span>
          </button>

          <button
            type="button"
            onClick={exportRows}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
            title={
              selectedRows.length > 0
                ? "Exportar la selección"
                : serverMode
                  ? "Exportar la página actual"
                  : "Exportar todas las filas de esta vista"
            }
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            <span className="hidden xl:inline">Exportar</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="border-b border-border px-4 py-2.5">
          <LoadingState label={loadingLabel} compact />
        </div>
      )}

      <div className={fitToWidth ? "overflow-x-clip overflow-y-visible" : "overflow-x-auto"}>
        <table
          className={cn(
            "w-full border-collapse text-[13px] tabular-nums",
            fitToWidth && "table-fixed leading-snug",
            compact && "text-xs"
          )}
        >
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-raised text-left text-xs text-muted-foreground">
              {selectable && (
                <th className={cn("w-10 pl-4 pr-1", compact ? "h-8" : "h-10")}>
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
                      fitToWidth ? "min-w-0 break-words px-2 py-2 font-medium" : cn("whitespace-nowrap px-3 font-medium", compact ? "h-8" : "h-10"),
                      column.align === "right" && "text-right",
                      column.className
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        fitToWidth && "w-full min-w-0 flex-wrap gap-0.5",
                        column.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                        >
                          {column.header ?? definition?.label}
                          <Icon size={12} className={active ? "text-foreground" : "text-muted-foreground/40"} />
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

              {showRowAction && <th className="w-10" aria-label="Acción" />}
            </tr>
          </thead>

          <tbody className="divide-y divide-border/70">
            {loading &&
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton-${index}`}>
                  <td colSpan={columnSpan} className="px-4 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="size-7 shrink-0 animate-pulse rounded-full bg-surface-muted" />
                      <span className="h-3.5 w-1/3 animate-pulse rounded bg-surface-muted" />
                      <span className="ml-auto h-3.5 w-1/5 animate-pulse rounded bg-surface-muted" />
                    </span>
                  </td>
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan={columnSpan} className="px-5 py-10 text-center">
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
                <td colSpan={columnSpan} className="px-5 py-16 text-center">
                  <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border border-border bg-surface-raised text-muted-foreground">
                    <Inbox size={20} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                  {emptyDescription && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{emptyDescription}</p>}
                  {emptyAction && <div className="mt-4 flex justify-center">{emptyAction}</div>}
                </td>
              </tr>
            )}

            {!loading &&
              !error &&
              pageRows.map((row) => {
                const id = getRowId(row);
                const href = rowHref?.(row);
                const isSelected = selected.includes(id);

                return (
                  <tr
                    key={id}
                    onClick={href ? () => router.push(href) : undefined}
                    className={cn(
                      "group transition-colors hover:bg-surface-muted/55",
                      href && "cursor-pointer",
                      isSelected && "bg-primary/[0.06] hover:bg-primary/[0.08]"
                    )}
                  >
                    {selectable && (
                      <td className={cn("w-10 pl-4 pr-1", compact ? "py-1.5" : "py-3")} onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar fila"
                          className="accent-primary"
                          checked={isSelected}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
                            )
                          }
                        />
                      </td>
                    )}

                    {visibleColumns.map((column) => {
                      const content = column.cell ? column.cell(row) : column.value?.(row) ?? "—";
                      return (
                        <td
                          key={column.id}
                          className={cn(cellPadding, column.align === "right" && "text-right", column.className)}
                        >
                          {content}
                        </td>
                      );
                    })}

                    {showRowAction && href && (
                      <td className={cn("pl-1 pr-3 text-right", compact ? "py-1.5" : "py-1")}>
                        {/* La fila completa ya navega; el enlace existe para
                            teclado y lectores de pantalla, así que no debe
                            disparar además el clic de la fila. */}
                        <Link
                          href={href}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={rowActionLabel?.(row) ?? "Abrir"}
                          title={rowActionLabel?.(row) ?? "Abrir"}
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors group-hover:bg-surface group-hover:text-foreground group-hover:shadow-sm group-hover:ring-1 group-hover:ring-border focus:outline-none focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </Link>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pie: cuántas filas hay y dónde estás. Ninguna tabla corta filas sin decirlo. */}
      <div className="flex min-h-11 flex-wrap items-center gap-3 border-t border-border bg-surface-raised px-4 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {total === 0 ? (
            "Sin filas"
          ) : (
            <>
              <span className="font-medium text-foreground">
                {firstShown.toLocaleString("es-CL")}–{lastShown.toLocaleString("es-CL")}
              </span>{" "}
              de {total.toLocaleString("es-CL")}
            </>
          )}
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
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className={buttonClasses({ variant: "secondary", size: "sm", className: "w-8 px-0" })}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2 tabular-nums">
              Página <span className="font-medium text-foreground">{page.toLocaleString("es-CL")}</span> de{" "}
              {pageCount.toLocaleString("es-CL")}
            </span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= pageCount}
              aria-label="Página siguiente"
              className={buttonClasses({ variant: "secondary", size: "sm", className: "w-8 px-0" })}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Acciones masivas: flotan abajo mientras haya selección, sin empujar la
          tabla ni obligar a volver arriba a buscarlas. */}
      {selectable && selected.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div
            role="region"
            aria-label="Acciones sobre la selección"
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-surface-solid py-1.5 pl-4 pr-1.5 shadow-2xl"
          >
            <span className="text-sm font-medium tabular-nums text-foreground">
              {selected.length.toLocaleString("es-CL")} {selected.length === 1 ? "seleccionado" : "seleccionados"}
            </span>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Quitar selección
            </button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
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
    </div>
  );
}
