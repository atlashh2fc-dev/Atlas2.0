"use client";

import { useMemo, useState } from "react";
import { CalendarClock, History, Mail, MessageCircle, MessageSquare, PhoneCall, RefreshCw } from "lucide-react";
import { Avatar, EmptyState } from "@/components/ui";
import {
  Timeline,
  TimelineItem,
  TimelineNote,
  dateTimeLabel,
  dayGroupKey,
  dayGroupLabel,
  sentenceCase,
  type ChipTone,
} from "@/components/record-kit";
import { cn } from "@/lib/utils";

export type TimelineEntry = {
  key: string;
  source: "call" | "email" | "interaction" | "integration" | "whatsapp";
  date: string | null;
  title: string;
  notes: string | null;
  agenda: string | null;
  agent: string;
};

const FILTERS = [
  { id: "todo", label: "Todo" },
  { id: "call", label: "Llamadas" },
  { id: "interaction", label: "Gestiones" },
  { id: "email", label: "Correo" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "integration", label: "Integraciones" },
] as const;

/** Icono y color por tipo de entrada, con el mismo criterio de canal que el menú. */
const SOURCE_CHIP: Record<TimelineEntry["source"], { icon: typeof PhoneCall; tone: ChipTone; label: string }> = {
  call: { icon: PhoneCall, tone: "primary", label: "Llamada" },
  email: { icon: Mail, tone: "teal", label: "Correo" },
  whatsapp: { icon: MessageCircle, tone: "green", label: "WhatsApp" },
  integration: { icon: RefreshCw, tone: "slate", label: "Integración" },
  interaction: { icon: MessageSquare, tone: "blue", label: "Gestión" },
};

/**
 * Línea de tiempo unificada del registro: llamadas, gestiones y canales en un solo hilo
 * ordenado, con filtro por tipo (docs/auditoria-vistas-workplace.md §4.3). Se agrupa por
 * día y cada hito lleva su ícono de canal, el autor con avatar y la fecha relativa.
 */
export function LeadTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("todo");

  const counts = useMemo(
    () => ({
      todo: entries.length,
      call: entries.filter((entry) => entry.source === "call").length,
      interaction: entries.filter((entry) => entry.source === "interaction").length,
      email: entries.filter((entry) => entry.source === "email").length,
      whatsapp: entries.filter((entry) => entry.source === "whatsapp").length,
      integration: entries.filter((entry) => entry.source === "integration").length,
    }),
    [entries]
  );

  const visible = filter === "todo" ? entries : entries.filter((entry) => entry.source === filter);

  // Un día por bloque: lo de hoy, lo de ayer y lo anterior se leen de un vistazo.
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

  // Solo los tipos que existen en este registro: una pestaña en cero es ruido.
  const tabs = FILTERS.filter((item) => item.id === "todo" || counts[item.id] > 0);

  return (
    <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-border px-5 pt-3">
        <h2 className="pb-3 text-[15px] font-semibold tracking-tight text-foreground">Actividad</h2>
        {entries.length > 0 && (
          <div role="tablist" aria-label="Filtrar actividad" className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          title={entries.length === 0 ? "Sin actividad todavía" : "No hay actividad de este tipo"}
          description={
            entries.length === 0
              ? "Al cerrar la primera gestión aparecerá acá, con quién la hizo y qué quedó agendado."
              : undefined
          }
          className="py-10"
        />
      ) : (
        <div className="space-y-6 px-5 py-5">
          {days.map((day) => (
            <div key={day.key}>
              <h3 suppressHydrationWarning className="mb-3 text-xs font-medium text-muted-foreground">{day.label}</h3>
              <Timeline>
                {day.items.map((entry, index) => {
                  const chip = SOURCE_CHIP[entry.source];
                  // Las integraciones no son una persona: su avatar es cuadrado.
                  const system = entry.source === "integration";
                  return (
                    <TimelineItem
                      key={entry.key}
                      icon={chip.icon}
                      tone={chip.tone}
                      title={sentenceCase(entry.title)}
                      date={entry.date}
                      author={entry.agent}
                      authorAvatar={<Avatar name={entry.agent} size="xs" shape={system ? "square" : "circle"} />}
                      meta={chip.label}
                      last={index === day.items.length - 1}
                    >
                      {entry.notes && <TimelineNote>{entry.notes}</TimelineNote>}
                      {entry.agenda && (
                        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <span className="icon-chip size-5 rounded" data-tone="amber" aria-hidden="true">
                            <CalendarClock size={11} />
                          </span>
                          Agendó para el {dateTimeLabel(entry.agenda)}
                        </p>
                      )}
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
