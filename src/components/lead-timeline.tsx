"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, History, Mail, MessageCircle, MessageSquare, PhoneCall, RefreshCw } from "lucide-react";
import { Avatar, EmptyState } from "@/components/ui";
import { dateTimeLabel, dayGroupKey, dayGroupLabel, sentenceCase } from "@/components/record-kit";
import { prepareActivity, type ActivityEntry, type ActivitySource } from "@/lib/lead-activity";
import { cn } from "@/lib/utils";

export type TimelineEntry = ActivityEntry;

const FILTERS = [
  { id: "todo", label: "Todo" },
  { id: "call", label: "Llamadas" },
  { id: "interaction", label: "Gestiones" },
  { id: "email", label: "Correo" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "integration", label: "Integraciones" },
] as const;

const CHANNEL: Record<ActivitySource, { icon: typeof PhoneCall; label: string }> = {
  call: { icon: PhoneCall, label: "Llamada" },
  interaction: { icon: MessageSquare, label: "Gestión" },
  email: { icon: Mail, label: "Correo" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
  integration: { icon: RefreshCw, label: "Sistema" },
};

const chileTime = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function timeOf(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : chileTime.format(date);
}

/** Un mensaje del canal es el texto mismo; una gestión o un correo llevan su título. */
function isPlainMessage(entry: ActivityEntry): boolean {
  return entry.source === "whatsapp" && /^WhatsApp (recibido|enviado)$/.test(entry.title);
}

function Bubble({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  const mine = entry.side === "equipo";
  const channel = CHANNEL[entry.source];
  const Icon = channel.icon;
  const plain = isPlainMessage(entry);

  return (
    <div className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row")}>
      {/* El avatar va una vez por tanda: la misma persona hablando seguido no se repite. */}
      <span className="w-7 shrink-0" aria-hidden={!first}>
        {first && <Avatar name={entry.agent} size="xs" />}
      </span>
      <div className={cn("flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
        {first && (
          <p className="mb-1 px-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{entry.agent}</span> · {channel.label}
          </p>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed text-foreground",
            mine ? "rounded-br-md bg-primary/[0.13]" : "rounded-bl-md border border-border bg-surface shadow-sm"
          )}
        >
          {!plain && (
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              {sentenceCase(entry.title)}
            </p>
          )}
          {entry.notes && (
            <p className={cn("whitespace-pre-wrap break-words", !plain && "mt-0.5 text-muted-foreground")}>{entry.notes}</p>
          )}
          {entry.agenda && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-surface/70 px-2 py-0.5 text-xs font-medium text-foreground">
              <CalendarClock size={12} className="text-warning" aria-hidden="true" />
              <span suppressHydrationWarning>Agendó para el {dateTimeLabel(entry.agenda)}</span>
            </p>
          )}
          <time
            dateTime={entry.date ?? undefined}
            suppressHydrationWarning
            className="mt-0.5 block text-right text-[11px] tabular-nums text-muted-foreground"
          >
            {timeOf(entry.date)}
          </time>
        </div>
      </div>
    </div>
  );
}

/** Lo que pasó solo (un correo abierto, una sincronización): al centro, chico, sin burbuja. */
function SystemNote({ entry }: { entry: ActivityEntry }) {
  const Icon = CHANNEL[entry.source].icon;
  return (
    <div className="flex justify-center py-0.5">
      <p className="inline-flex max-w-[90%] items-start gap-1.5 rounded-xl bg-surface-muted px-3 py-1.5 text-center text-[11px] leading-snug text-muted-foreground">
        <Icon size={12} className="mt-px shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground/80">{entry.agent}</span>: {sentenceCase(entry.title)}
          {entry.notes ? ` · ${entry.notes}` : ""}
          <span suppressHydrationWarning className="tabular-nums"> · {timeOf(entry.date)}</span>
        </span>
      </p>
    </div>
  );
}

/**
 * Actividad del registro como una conversación: el cliente a la izquierda, el
 * equipo a la derecha y lo automático al centro, igual que la vista de chat.
 * Se lee de arriba hacia abajo y abre en lo más reciente.
 */
export function LeadTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("todo");
  const scroller = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => prepareActivity(entries), [entries]);

  const counts = useMemo(() => {
    const base = { todo: prepared.length, call: 0, interaction: 0, email: 0, whatsapp: 0, integration: 0 };
    for (const entry of prepared) base[entry.source] += 1;
    return base;
  }, [prepared]);

  const visible = filter === "todo" ? prepared : prepared.filter((entry) => entry.source === filter);

  const days = useMemo(() => {
    const groups: { key: string; label: string; items: TimelineEntry[] }[] = [];
    for (const entry of visible) {
      const key = dayGroupKey(entry.date);
      const current = groups.at(-1);
      if (current && current.key === key) current.items.push(entry);
      else groups.push({ key, label: dayGroupLabel(entry.date), items: [entry] });
    }
    return groups;
  }, [visible]);

  // Como en un chat, se abre en lo último que pasó.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [filter, prepared]);

  const tabs = FILTERS.filter((item) => item.id === "todo" || counts[item.id] > 0);

  return (
    <section className="atlas-panel min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-border px-5 pt-3">
        <div className="pb-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Actividad</h2>
          {prepared.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">Cliente a la izquierda · equipo a la derecha</p>
          )}
        </div>
        {prepared.length > 0 && (
          <div role="tablist" aria-label="Filtrar actividad" className="-mb-px flex min-w-0 max-w-full items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((item) => {
              const active = item.id === filter;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "group relative inline-flex h-11 shrink-0 items-center gap-2 px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums",
                      active ? "bg-foreground/[0.08] text-foreground" : "bg-surface-muted text-muted-foreground"
                    )}
                  >
                    {counts[item.id]}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", active ? "bg-primary" : "bg-transparent")}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={History}
          title={prepared.length === 0 ? "Sin actividad todavía" : "No hay actividad de este tipo"}
          description={
            prepared.length === 0
              ? "Al cerrar la primera gestión o llegar el primer mensaje aparecerá acá."
              : undefined
          }
          className="py-10"
        />
      ) : (
        <div
          ref={scroller}
          className="max-h-[680px] space-y-5 overflow-y-auto bg-background px-3 py-5 sm:px-5"
          aria-label="Historial del registro"
        >
          {days.map((day) => (
            <div key={day.key} className="space-y-2">
              <div className="flex items-center gap-3 py-1" role="separator" aria-label={day.label}>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
                <span suppressHydrationWarning className="text-[11px] font-medium text-muted-foreground">{day.label}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              {day.items.map((entry, index) => {
                if (entry.side === "sistema") return <SystemNote key={entry.key} entry={entry} />;
                const previous = day.items[index - 1];
                const first = !previous || previous.side !== entry.side || previous.agent !== entry.agent;
                return (
                  <div key={entry.key} className={first && index > 0 ? "pt-2" : undefined}>
                    <Bubble entry={entry} first={first} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
