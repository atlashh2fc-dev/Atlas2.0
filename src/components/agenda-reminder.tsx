"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Bell, AlertTriangle } from "lucide-react";

interface AgendaItem {
  id: string;
  full_name: string;
  next_action_at: string;
}

interface AgendaContextValue {
  items: AgendaItem[];
  overdue: AgendaItem[];
  nowTick: number;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/**
 * Agendas del ejecutivo logueado (managed_by = userId): trae próximas y
 * vencidas, se mantiene al día con realtime sobre `leads` + un tick cada
 * 30s para recalcular qué está vencido sin depender de refetch.
 */
function useAgendaSubscription(userId: string): AgendaContextValue {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("leads")
      .select("id, full_name, next_action_at")
      .eq("managed_by", userId)
      .not("next_action_at", "is", null)
      .order("next_action_at", { ascending: true })
      .limit(15);
    setItems((data ?? []) as AgendaItem[]);
  }, [userId]);

  useEffect(() => {
    // El await dentro del IIFE difiere el setState al siguiente microtask,
    // evitando una actualización sincrónica dentro del cuerpo del efecto.
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    const tickId = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(tickId);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`agenda-reminder-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const overdue = useMemo(
    () => items.filter((i) => new Date(i.next_action_at).getTime() <= nowTick),
    [items, nowTick]
  );

  return { items, overdue, nowTick };
}

function useAgenda() {
  const value = useContext(AgendaContext);
  if (!value) {
    throw new Error("AgendaBell y AgendaBanner deben renderizarse dentro de AgendaProvider.");
  }
  return value;
}

export function AgendaProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const agenda = useAgendaSubscription(userId);
  return <AgendaContext.Provider value={agenda}>{children}</AgendaContext.Provider>;
}

/** Campana en el header: contador + dropdown con las próximas/vencidas agendas del ejecutivo. */
export function AgendaBell() {
  const { items, overdue, nowTick } = useAgenda();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        title="Mis agendas"
        aria-label="Mis agendas"
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
              overdue.length > 0 ? "bg-danger" : "bg-primary"
            }`}
          >
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-72 rounded-xl border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Mis agendas</p>
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-4 text-sm text-muted-foreground">No tienes agendas pendientes.</li>
              )}
              {items.map((i) => {
                const isOverdue = new Date(i.next_action_at).getTime() <= nowTick;
                return (
                  <li key={i.id}>
                    <Link
                      href={`/dashboard/leads/${i.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-3 hover:bg-surface-muted"
                    >
                      <p className="text-sm font-medium text-foreground">{i.full_name}</p>
                      <p className={`text-xs ${isOverdue ? "font-medium text-danger" : "text-muted-foreground"}`}>
                        {isOverdue ? "Vencida: " : ""}
                        {new Date(i.next_action_at).toLocaleString("es-CL")}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border px-4 py-2 text-center">
              <Link
                href="/dashboard/agenda"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver mi agenda completa
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Banner que aparece debajo del header en todas las pantallas cuando hay agendas vencidas. */
export function AgendaBanner() {
  const { overdue } = useAgenda();
  const [dismissedCount, setDismissedCount] = useState<number | null>(null);

  if (overdue.length === 0 || dismissedCount === overdue.length) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-bg px-6 py-2 text-sm">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle size={16} />
        <span>
          Tienes {overdue.length} agenda{overdue.length > 1 ? "s" : ""} vencida{overdue.length > 1 ? "s" : ""}.
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/dashboard/agenda" className="text-xs font-medium text-danger underline">
          Ver agenda
        </Link>
        <button
          type="button"
          onClick={() => setDismissedCount(overdue.length)}
          className="text-xs text-danger/70 hover:text-danger"
        >
          Ocultar
        </button>
      </div>
    </div>
  );
}
