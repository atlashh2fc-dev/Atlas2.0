function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

export default function LeadsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Bar className="h-6 w-32" />
        <Bar className="h-4 w-64" />
      </div>

      <Bar className="h-10 w-full max-w-md" />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <Bar className="h-3 w-full" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-5 py-4">
              <Bar className="h-4 w-40" />
              <Bar className="h-4 w-24" />
              <Bar className="h-4 w-28" />
              <Bar className="h-4 w-20" />
              <Bar className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
