import { Skeleton } from "@/components/ui";

/** Esqueleto con la forma de la lista: encabezado, cifras del día y la tabla. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando las campañas de correo" className="relative space-y-5">
      <div className="absolute -top-5 left-0 right-0 h-0.5 overflow-hidden" aria-hidden="true">
        <div className="progress-indeterminate h-full w-1/2 rounded-full bg-primary" />
      </div>
      <span className="sr-only">Cargando las campañas de correo</span>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2 pt-0.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3.5 w-72 max-w-[60vw]" />
          </div>
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
