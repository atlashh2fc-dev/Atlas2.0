import { LoadingState } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <LoadingState label="Estamos preparando los reportes de la clínica" className="rounded-xl border border-border bg-surface px-5 py-4" />
      <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-xl bg-surface-muted" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-72 animate-pulse rounded-xl bg-surface-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-surface-muted xl:col-span-2" />
      </div>
    </div>
  );
}
