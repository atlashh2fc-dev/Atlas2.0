import { Skeleton } from "@/components/ui";

/**
 * Esqueleto con la forma del calendario: encabezado, franja de resumen,
 * filtros y la semana en siete columnas. Así la espera ya se lee como el
 * calendario y no hay salto cuando llega.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando el calendario de Marketing" className="relative space-y-5">
      <div className="absolute -top-5 left-0 right-0 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="progress-indeterminate h-full w-1/2 rounded-full bg-primary" />
      </div>
      <span className="sr-only">Cargando el calendario de Marketing</span>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2 pt-0.5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-64 max-w-[60vw]" />
          </div>
        </div>
        <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 bg-surface p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>

      <Skeleton className="h-14 w-full rounded-xl" />

      <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="min-h-72 space-y-2 bg-surface p-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-14 w-full rounded-lg" />
            {i % 2 === 0 && <Skeleton className="h-14 w-full rounded-lg" />}
          </div>
        ))}
      </div>
      <div className="space-y-3 md:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border bg-surface p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
