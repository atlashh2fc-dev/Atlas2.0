export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-14 animate-pulse rounded-lg bg-surface-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-surface-muted" />
    </div>
  );
}
