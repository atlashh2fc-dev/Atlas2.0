export type ServiceProbe = "ok" | "down" | "unknown";

type DialerHealthRow = {
  status: string;
  reported_at: string;
};

export function interpretDialerHeartbeat(
  row: DialerHealthRow | null,
  now = Date.now(),
  staleAfterMs = 45_000
): ServiceProbe {
  if (!row) return "unknown";
  const reportedAt = Date.parse(row.reported_at);
  if (!Number.isFinite(reportedAt) || now - reportedAt > staleAfterMs) return "down";
  return row.status === "ready" ? "ok" : "down";
}
