function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

export default function LeadDetailLoading() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-1">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <Bar className="h-5 w-40" />
            <Bar className="h-6 w-20 rounded-full" />
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Bar key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <Bar className="mb-3 h-4 w-32" />
          <Bar className="h-2 w-full" />
        </div>
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <Bar className="h-4 w-36" />
          </div>
          <div className="space-y-4 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Bar key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <Bar className="mb-4 h-4 w-48" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Bar key={i} className="h-9 w-full" />
            ))}
          </div>
          <Bar className="mt-4 h-20 w-full" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <Bar className="h-9 w-40" />
        </div>
      </div>
    </div>
  );
}
