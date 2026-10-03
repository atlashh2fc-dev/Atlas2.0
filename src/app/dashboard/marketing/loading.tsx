import { Skeleton } from "@/components/ui";

/**
 * Esqueleto con la forma del calendario en su vista de entrada («Próximos»):
 * encabezado, atajos y estados, franja de resumen, filtros y la agenda por
 * día. Así la espera ya se lee como el calendario y no hay salto cuando llega.
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
        <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
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

      <div className="space-y-3">
        {[3, 2, 2].map((filas, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: filas }, (_, j) => (
                <div key={j} className="flex items-center gap-3 px-4 py-2.5">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="size-12 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                  <Skeleton className="hidden h-4 w-20 sm:block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
