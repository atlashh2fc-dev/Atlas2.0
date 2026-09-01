"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Mail, MessageCircle, MessageSquare, PhoneCall, RefreshCw } from "lucide-react";

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

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Línea de tiempo unificada del registro: llamadas, gestiones y canales en un solo hilo
 * ordenado, con filtro por tipo (docs/auditoria-vistas-workplace.md §4.3).
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

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Historial</h2>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const active = item.id === filter;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {item.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                    active ? "bg-primary-foreground/20" : "bg-surface-muted"
                  }`}
                >
                  {counts[item.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {entries.length === 0
            ? "Sin gestiones registradas todavía. Al cerrar la primera llamada aparecerá acá."
            : "No hay registros de este tipo."}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {visible.map((entry) => {
            const Icon = entry.source === "call"
              ? PhoneCall
              : entry.source === "email"
                ? Mail
              : entry.source === "integration"
                ? RefreshCw
                : entry.source === "whatsapp"
                  ? MessageCircle
                  : MessageSquare;
            return (
              <li key={entry.key} className="flex gap-3 px-4 py-3.5">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                  <Icon size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{entry.title}</p>
                    <span className="text-xs text-muted-foreground">{formatDateTime(entry.date)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.agent}</p>
                  {entry.notes && <p className="mt-1.5 text-sm text-muted-foreground">{entry.notes}</p>}
                  {entry.agenda && (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary">
                      <CalendarClock size={12} aria-hidden="true" />
                      Agendó para {formatDateTime(entry.agenda)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
