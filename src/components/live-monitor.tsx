"use client";

import { useEffect, useState } from "react";
import { getAgentLiveStatus, getQueueHealth } from "@/app/actions/supervision";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";

const POLL_MS = 5000;

function formatElapsed(sinceIso: string | null, now: number): string {
  if (!sinceIso) return "—";
  const ms = Math.max(0, now - new Date(sinceIso).getTime());
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function agentDisplay(a: AgentLiveStatus): { label: string; colorClass: string; since: string | null } {
  if (a.phone_status === "on_call") {
    return { label: "En llamada", colorClass: "bg-primary", since: a.phone_status_since };
  }
  if (a.phone_status === "ringing") {
    return { label: "Timbrando", colorClass: "bg-warning", since: a.phone_status_since };
  }
  if (a.is_pause && a.reason_label) {
    return { label: a.reason_label, colorClass: "bg-danger", since: a.reason_since };
  }
  if (a.phone_status === "wrap_up") {
    return { label: "Posterior a llamada", colorClass: "bg-warning", since: a.phone_status_since };
  }
  if (a.phone_status === "available") {
    return { label: "Disponible", colorClass: "bg-success", since: a.reason_since ?? a.phone_status_since };
  }
  return { label: "Sin conexión", colorClass: "bg-muted-foreground/40", since: null };
}

function QueueHealthCard({ q }: { q: QueueHealth }) {
  const handled = q.answered_today + q.abandoned_today;
  const abandonRate = handled > 0 ? Math.round((q.abandoned_today / handled) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm font-medium text-foreground">{q.campaign_name}</p>
      <p className="text-xs text-muted-foreground">Cola: {q.queue_name}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xl font-semibold text-foreground">{q.in_flight}</p>
          <p className="text-[11px] text-muted-foreground">En curso ahora</p>
        </div>
        <div>
          <p className="text-xl font-semibold text-foreground">{q.answered_today}</p>
          <p className="text-[11px] text-muted-foreground">Contestadas hoy</p>
        </div>
        <div>
          <p className={`text-xl font-semibold ${abandonRate > 6 ? "text-danger" : "text-foreground"}`}>
            {q.abandoned_today}
          </p>
          <p className="text-[11px] text-muted-foreground">Abandonadas hoy ({abandonRate}%)</p>
        </div>
        <div>
          <p className="text-xl font-semibold text-foreground">{q.no_answer_today}</p>
          <p className="text-[11px] text-muted-foreground">No contesta hoy</p>
        </div>
      </div>
    </div>
  );
}

export function LiveMonitor() {
  const [agents, setAgents] = useState<AgentLiveStatus[]>([]);
  const [queues, setQueues] = useState<QueueHealth[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function poll() {
      try {
        const [a, q] = await Promise.all([getAgentLiveStatus(), getQueueHealth()]);
        if (disposed) return;
        setAgents(a);
        setQueues(q);
        setError(null);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Error al cargar el monitor");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando monitor...</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">Error: {error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {queues.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay campañas activas para el motor de discado.</p>
        )}
        {queues.map((q) => (
          <QueueHealthCard key={q.campaign_id} q={q} />
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Ejecutivos ({agents.length})</h2>
        </div>
        <div className="divide-y divide-border">
          {agents.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">No hay ejecutivos con extensión activa.</p>
          )}
          {agents.map((a) => {
            const { label, colorClass, since } = agentDisplay(a);
            return (
              <div key={a.profile_id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{a.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Ext. {a.extension}
                    {a.campaign_name ? ` · ${a.campaign_name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
                  <span className="text-sm text-foreground">{label}</span>
                  <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                    {formatElapsed(since, now)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
