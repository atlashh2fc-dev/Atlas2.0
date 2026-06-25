"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Cronómetro de la llamada en curso. Estándar en cualquier herramienta de
 * call center y ayuda al agente a manejar el ritmo de la conversación.
 * Si la llamada ya está cerrada (endedAt), muestra la duración final fija.
 */
export function CallTimer({ startedAt, endedAt }: { startedAt: string; endedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endedAt) return; // ya terminó, no hace falta seguir el tick
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAt]);

  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const elapsed = formatElapsed(end - start);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        endedAt ? "bg-surface-muted text-muted-foreground" : "bg-success-bg text-success"
      }`}
    >
      <Clock size={12} />
      {elapsed}
      {!endedAt && <span className="ml-0.5">en curso</span>}
    </span>
  );
}
