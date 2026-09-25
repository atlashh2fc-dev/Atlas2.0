"use client";

import { useEffect, useState } from "react";
import { getMyStatusDay, type MyStatusDay } from "@/app/actions/agent-status";
import { cn } from "@/lib/utils";

const REFRESH_MS = 20_000;

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Totales de la jornada del ejecutivo: tiempo conectado, tiempo acumulado
 * hoy en cada estado (Disponible, Descanso, Baño…), gestiones y TMO. Va en
 * la misma barra que el estado del teléfono: el estado muestra el tiempo
 * desde el último cambio y aquí se ve lo acumulado del día, sin repetir cuál
 * es el estado actual.
 *
 * Se consulta cada 20 s y entre consultas el estado actual avanza solo.
 */
export function AgentDayBar() {
  const [day, setDay] = useState<MyStatusDay | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const data = await getMyStatusDay();
        if (disposed) return;
        setDay(data);
        setFetchedAt(Date.now());
      } catch (err) {
        console.error("Barra de jornada: no se pudieron leer los totales", err);
      }
    }
    void load();
    const refresh = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, []);

  if (!day) return null;
  const drift = Math.max(0, (now - fetchedAt) / 1000);
  const currentId = day.actual?.reason_id ?? null;
  const currentCounts = day.estados.some((state) => state.reason_id === currentId);
  const states = day.estados.filter((state) => state.segundos > 0 || state.reason_id === currentId);

  return (
    <div
      role="status"
      aria-label="Tu jornada de hoy"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none]"
    >
      <span className="ml-auto shrink-0 font-semibold text-muted-foreground">Hoy</span>
      <Chip label="Conectado" value={formatDuration(day.conectado_segundos + (currentCounts ? drift : 0))} strong />
      {states.map((state) => {
        const current = state.reason_id === currentId;
        return (
          <Chip
            key={state.reason_id}
            label={state.label}
            value={formatDuration(state.segundos + (current ? drift : 0))}
          />
        );
      })}
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
      <Chip label="Gestiones" value={String(day.gestiones)} />
      <Chip label="TMO" value={formatDuration(day.tmo_segundos)} />
    </div>
  );
}

function Chip({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-muted/60 px-2.5 py-0.5 text-foreground">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums", strong && "font-semibold")}>{value}</span>
    </span>
  );
}
