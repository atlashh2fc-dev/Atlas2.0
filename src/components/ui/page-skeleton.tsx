import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Bloque del esqueleto con el brillo de carga (ver `.skeleton` en globals.css). */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} style={style} />;
}

/**
 * Esqueleto de una página mientras llega del servidor: tiene la forma de lo que
 * viene (encabezado con su baldosa, franja de indicadores, tabla con avatares),
 * así la espera se lee como "ya casi está" y no hay salto al cargar.
 *
 * - `table`: encabezado + filtros + tabla (Registros, Usuarios, Campañas).
 * - `dashboard`: encabezado + franja de KPIs + dos paneles + tabla.
 * - `detail`: cabecera de identidad + columna de propiedades + línea de tiempo.
 */
export function PageSkeleton({
  variant = "table",
  label = "Cargando",
  header = true,
}: {
  variant?: "table" | "dashboard" | "detail";
  /** Falso cuando el layout ya dibuja el encabezado de la sección. */
  header?: boolean;
  /** Qué se está cargando, para lectores de pantalla. */
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="relative space-y-5">
      {/* Progreso fino arriba: confirma en el primer instante que algo pasa. */}
      <div className="absolute -top-5 left-0 right-0 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="progress-indeterminate h-full w-1/2 rounded-full bg-primary" />
      </div>
      <span className="sr-only">{label}</span>

      {variant === "detail" ? <DetailSkeleton /> : header && <HeaderSkeleton />}
      {variant === "dashboard" && <KpiSkeleton />}
      {variant === "table" && <FilterSkeleton />}
      {variant === "dashboard" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      )}
      {variant !== "detail" && <TableSkeleton rows={variant === "table" ? 8 : 5} />}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="space-y-2 pt-0.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-80 max-w-[60vw]" />
        </div>
      </div>
      <Skeleton className="hidden h-9 w-36 rounded-lg sm:block" />
    </div>
  );
}

function FilterSkeleton() {
  return (
    <div className="flex gap-2.5 rounded-xl border border-border bg-surface p-3 shadow-sm">
      <Skeleton className="h-9 flex-1 rounded-lg" />
      <Skeleton className="hidden h-9 w-44 rounded-lg md:block" />
      <Skeleton className="hidden h-9 w-44 rounded-lg md:block" />
      <Skeleton className="h-9 w-20 rounded-lg" />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <Skeleton className="h-3.5 w-36" />
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-3 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <Skeleton className="h-3.5 w-40" />
      <div className="flex h-48 items-end gap-2">
        {[40, 65, 50, 80, 60, 90, 70, 55, 75, 45].map((height, index) => (
          <Skeleton key={index} className="flex-1 rounded-b-none rounded-t-md" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        {[64, 56, 48, 72, 56].map((width, index) => (
          <Skeleton key={index} className="h-3.5" style={{ width }} />
        ))}
      </div>
      <div className="h-10 border-b border-border bg-surface-raised" />
      <div className="divide-y divide-border/70">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3" style={{ opacity: 1 - index * 0.08 }}>
            <Skeleton className="size-9 rounded-lg" />
            <div className="w-56 space-y-1.5">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="hidden h-3.5 w-28 md:block" />
            <Skeleton className="hidden h-3.5 w-24 lg:block" />
            <Skeleton className="ml-auto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <Skeleton className="size-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-3.5 w-48" />
        </div>
        <Skeleton className="hidden h-9 w-28 rounded-lg sm:block" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ))}
        </div>
        <div className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
