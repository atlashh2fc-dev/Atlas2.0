import { LoadingState } from "@/components/ui";

export default function CalidadLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <LoadingState
        label="Estamos preparando las grabaciones"
        className="rounded-xl border border-border bg-surface px-5 py-4"
      />
      <div className="h-16 animate-pulse rounded-lg bg-surface-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-surface-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-surface-muted" />
    </div>
  );
}
