"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getMyAgendaCampaignId } from "@/lib/agenda-scope";
import { Bell, AlertTriangle } from "lucide-react";

interface AgendaItem {
  id: string;
  full_name: string;
  next_action_at: string;
  next_action_channel: "phone" | "whatsapp" | "video_meeting" | "in_person" | null;
  extra: Record<string, unknown> | null;
}

function agendaChannelLabel(channel: AgendaItem["next_action_channel"]): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "video_meeting") return "Videollamada";
  if (channel === "in_person") return "Presencial";
  return "Llamada";
}

interface AgendaContextValue {
  items: AgendaItem[];
  overdue: AgendaItem[];
  overdueTotal: number;
  nowTick: number;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/** Por grupo: la campana muestra las próximas y las vencidas más recientes. */
const AGENDA_BELL_LIMIT = 10;

/**
 * Agendas del ejecutivo logueado (managed_by = userId): trae próximas y
 * vencidas, se mantiene al día con realtime sobre `leads` + un tick cada
 * 30s para recalcular qué está vencido sin depender de refetch.
 *
 * Próximas y vencidas se piden por separado: con una sola lista ordenada por
 * fecha y un límite, quien acumulaba vencidas (82 en Equifax el 28-09-2026)
 * llenaba el cupo con ellas y nunca veía lo que acababa de agendar.
 */
function useAgendaSubscription(userId: string): AgendaContextValue {
  const [upcoming, setUpcoming] = useState<AgendaItem[]>([]);
  const [overdueRecent, setOverdueRecent] = useState<AgendaItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    // Solo la campaña en la que está trabajando: se pregunta en cada refresco
    // porque el ejecutivo o su supervisor pueden cambiarla durante el día.
    const agendaCampaignId = await getMyAgendaCampaignId(supabase);
    const nowIso = new Date().toISOString();
    const base = () => {
      const query = supabase
        .from("leads")
        .select("id, full_name, next_action_at, next_action_channel, extra", { count: "exact" })
        .eq("managed_by", userId)
        .not("next_action_at", "is", null);
      if (agendaCampaignId) query.eq("campaign_id", agendaCampaignId);
      return query;
    };
    const [next, late] = await Promise.all([
      base().gt("next_action_at", nowIso).order("next_action_at", { ascending: true }).limit(AGENDA_BELL_LIMIT),
      base().lte("next_action_at", nowIso).order("next_action_at", { ascending: false }).limit(AGENDA_BELL_LIMIT),
    ]);
    if (!next.error) setUpcoming((next.data ?? []) as AgendaItem[]);
    if (!late.error) {
      setOverdueRecent((late.data ?? []) as AgendaItem[]);
      setOverdueCount(late.count ?? late.data?.length ?? 0);
    }
  }, [userId]);

  useEffect(() => {
    // El await dentro del IIFE difiere el setState al siguiente microtask,
    // evitando una actualización sincrónica dentro del cuerpo del efecto.
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    // El tick también refresca: un cambio de campaña no toca `leads` y el
    // realtime no lo avisa.
    const tickId = setInterval(() => {
      setNowTick(Date.now());
      void refresh();
    }, 30_000);
    return () => clearInterval(tickId);
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`agenda-reminder-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `managed_by=eq.${userId}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Próximas arriba: es lo recién comprometido con el cliente.
  const items = useMemo(() => [...upcoming, ...overdueRecent], [upcoming, overdueRecent]);
  const overdue = useMemo(
    () => items.filter((i) => new Date(i.next_action_at).getTime() <= nowTick),
    [items, nowTick]
  );
  // Las próximas que vencieron desde el último refresco también cuentan.
  const overdueTotal = overdueCount + (overdue.length - overdueRecent.length);

  return { items, overdue, overdueTotal, nowTick };
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
  const { items, overdue, overdueTotal, nowTick } = useAgenda();
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
            {overdueTotal > 0
              ? overdueTotal > 9 ? "9+" : overdueTotal
              : items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-72 rounded-xl border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Mis agendas</p>
              {overdueTotal > overdue.length && (
                <p className="text-xs text-muted-foreground">
                  Próximas y las {overdue.length} vencidas más recientes de {overdueTotal}.
                </p>
              )}
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-4 text-sm text-muted-foreground">No tienes agendas pendientes.</li>
              )}
              {items.map((i) => {
                const isOverdue = new Date(i.next_action_at).getTime() <= nowTick;
                const conversationId = typeof i.extra?.agenda_conversation_id === "string"
                  ? i.extra.agenda_conversation_id
                  : null;
                return (
                  <li key={i.id}>
                    <Link
                      href={i.next_action_channel === "whatsapp" && conversationId
                        ? `/dashboard/conversaciones/whatsapp?status=all&conversation=${conversationId}`
                        : `/dashboard/leads/${i.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-3 hover:bg-surface-muted"
                    >
                      <p className="text-sm font-medium text-foreground">{i.full_name}</p>
                      <p className={`text-xs ${isOverdue ? "font-medium text-danger" : "text-muted-foreground"}`}>
                        {isOverdue ? "Vencida: " : ""}
                        {agendaChannelLabel(i.next_action_channel)} · {new Date(i.next_action_at).toLocaleString("es-CL")}
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
  const { overdueTotal } = useAgenda();
  const [dismissedCount, setDismissedCount] = useState<number | null>(null);

  if (overdueTotal <= 0 || dismissedCount === overdueTotal) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger-bg px-6 py-2 text-sm">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle size={16} />
        <span>
          Tienes {overdueTotal} agenda{overdueTotal > 1 ? "s" : ""} vencida{overdueTotal > 1 ? "s" : ""}.
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/dashboard/agenda" className="text-xs font-medium text-danger underline">
          Ver agenda
        </Link>
        <button
          type="button"
          onClick={() => setDismissedCount(overdueTotal)}
          className="text-xs text-danger/70 hover:text-danger"
        >
          Ocultar
        </button>
      </div>
    </div>
  );
}
