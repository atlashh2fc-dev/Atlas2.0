import { Skeleton } from "@/components/ui";

/**
 * Esqueleto con la forma de Órbita: encabezado, cifras, el escenario oscuro de
 * la red (o la lista en el teléfono) y la columna de actividad. La espera ya
 * se lee como la pantalla y no hay salto cuando llega.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando Órbita" className="relative space-y-5">
      <div className="absolute -top-5 left-0 right-0 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="progress-indeterminate h-full w-1/2 rounded-full bg-primary" />
      </div>
      <span className="sr-only">Cargando Órbita</span>

      <div className="flex items-start gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="space-y-2 pt-0.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3.5 w-80 max-w-[60vw]" />
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 bg-surface p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="hidden aspect-[1000/760] items-center justify-center rounded-2xl border border-white/10 bg-[#060a14] md:flex" aria-hidden="true">
          <div className="relative size-48">
            <div className="absolute inset-0 animate-pulse rounded-full border border-slate-700/60" />
            <div className="absolute inset-[30%] animate-pulse rounded-full bg-slate-800/80" />
          </div>
        </div>
        <div className="space-y-2 md:hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-6 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
