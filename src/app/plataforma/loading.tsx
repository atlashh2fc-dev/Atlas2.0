export default function PlataformaLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Cargando la consola">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="h-20 animate-pulse rounded-xl bg-surface-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-surface-muted" />
    </div>
  );
}
