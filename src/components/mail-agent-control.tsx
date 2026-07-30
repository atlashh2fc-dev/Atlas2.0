"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronRight, Search, UsersRound } from "lucide-react";
import { Badge, Button, SlideOver } from "@/components/ui";

export type MailAgentControlRow = {
  agent_id: string;
  agent_name: string;
  assigned_leads: number;
  clicked_leads: number;
  opened_only_leads: number;
  uncontacted_leads: number;
  clicked_uncontacted_leads: number;
  contacted_leads: number;
  interactions: number;
  agendas: number;
  pending_agendas: number;
  overdue_agendas: number;
  no_next_action_leads: number;
  next_agenda_at: string | null;
  last_interaction_at: string | null;
  last_event_at: string | null;
  is_active: boolean;
};

type AgentFilter = "operational" | "attention" | "all" | "history";

const PAGE_SIZE = 12;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function attention(row: MailAgentControlRow) {
  if (row.overdue_agendas > 0) return { label: "Agendas vencidas", tone: "danger" as const, icon: AlertTriangle };
  if (row.clicked_uncontacted_leads > 0) return { label: "Clicks sin gestión", tone: "warning" as const, icon: AlertTriangle };
  if (row.no_next_action_leads > 0) return { label: "Sin próxima acción", tone: "warning" as const, icon: CalendarClock };
  if (row.assigned_leads === 0) return { label: "Sin carga", tone: "neutral" as const, icon: UsersRound };
  return { label: "En seguimiento", tone: "success" as const, icon: CalendarClock };
}

function needsAttention(row: MailAgentControlRow) {
  return row.overdue_agendas > 0 || row.clicked_uncontacted_leads > 0 || row.no_next_action_leads > 0;
}

export function MailAgentControl({ rows }: { rows: MailAgentControlRow[] }) {
  const [filter, setFilter] = useState<AgentFilter>("operational");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<MailAgentControlRow | null>(null);

  const counts = useMemo(
    () => ({
      operational: rows.filter((row) => row.is_active).length,
      attention: rows.filter(needsAttention).length,
      all: rows.length,
      history: rows.filter((row) => !row.is_active).length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return rows.filter((row) => {
      if (filter === "operational" && !row.is_active) return false;
      if (filter === "attention" && !needsAttention(row)) return false;
      if (filter === "history" && row.is_active) return false;
      return !normalized || row.agent_name.toLocaleLowerCase("es").includes(normalized);
    });
  }, [filter, query, rows]);

  const visible = filtered.slice(0, limit);
  const hidden = Math.max(0, filtered.length - visible.length);

  const filters: Array<{ id: AgentFilter; label: string }> = [
    { id: "operational", label: "Equipo activo" },
    { id: "attention", label: "Requieren atención" },
    { id: "all", label: "Todos" },
    { id: "history", label: "Histórico" },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Control por ejecutivo</h2>
          <p className="mt-1 text-xs text-muted-foreground">Filtra el equipo y abre una tarjeta para ver su carga sin abandonar la consola.</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">{counts.attention} con atención requerida</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/40 px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFilter(item.id);
                  setLimit(PAGE_SIZE);
                }}
                aria-pressed={active}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
              >
                {item.label} <span className="ml-1 tabular-nums opacity-80">{counts[item.id]}</span>
              </button>
            );
          })}
        </div>
        <label className="relative ml-auto min-w-48">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Buscar ejecutivo"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      <div className="grid max-h-[34rem] gap-3 overflow-y-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.length === 0 ? (
          <div className="col-span-full py-8 text-center text-sm text-muted-foreground">No hay ejecutivos en este grupo.</div>
        ) : (
          visible.map((row) => {
            const state = attention(row);
            const Icon = state.icon;
            return (
              <button
                key={row.agent_id}
                type="button"
                onClick={() => setSelected(row)}
                className="group rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-foreground">{row.agent_name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="truncate font-medium text-foreground">{row.agent_name}</span><ChevronRight size={16} className="text-muted-foreground" /></span>
                    <span className="mt-1 block"><Badge tone={state.tone}><Icon size={12} className="mr-1" aria-hidden />{state.label}</Badge></span>
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Carga" value={row.assigned_leads} />
                  <Metric label="Contactados" value={row.contacted_leads} />
                  <Metric label="Vencidos" value={row.overdue_agendas} danger={row.overdue_agendas > 0} />
                </div>
              </button>
            );
          })
        )}
      </div>

      {hidden > 0 && (
        <div className="flex justify-center border-t border-border px-4 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>Ver {Math.min(PAGE_SIZE, hidden)} más</Button>
        </div>
      )}

      <SlideOver
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.agent_name ?? "Detalle de ejecutivo"}
        description={selected ? `${attention(selected).label} · última gestión ${formatDate(selected.last_interaction_at)}` : undefined}
        width="md"
        footer={selected ? <Link href={`/dashboard/leads?agent=${selected.agent_id}&view=prioridad`} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">Ver sus registros</Link> : undefined}
      >
        {selected && <AgentDetail row={selected} />}
      </SlideOver>
    </section>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <span><span className={`block text-lg font-semibold tabular-nums ${danger ? "text-danger" : "text-foreground"}`}>{value.toLocaleString("es-CL")}</span><span className="block text-[10px] text-muted-foreground">{label}</span></span>;
}

function AgentDetail({ row }: { row: MailAgentControlRow }) {
  const stats = [
    ["Leads en carga", row.assigned_leads], ["Clicks", row.clicked_leads], ["Aperturas", row.opened_only_leads], ["Contactados", row.contacted_leads],
    ["Clicks sin gestión", row.clicked_uncontacted_leads], ["Gestiones CRM", row.interactions], ["Agendas pendientes", row.pending_agendas], ["Agendas vencidas", row.overdue_agendas],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {stats.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={label === "Agendas vencidas" && value > 0 ? "mt-1 text-xl font-semibold text-danger" : "mt-1 text-xl font-semibold text-foreground"}>{value.toLocaleString("es-CL")}</p></div>)}
      </div>
      <div className="rounded-lg border border-border bg-background p-4 text-sm"><p className="font-medium text-foreground">Próximo seguimiento</p><p className="mt-1 text-muted-foreground">Próxima agenda: {formatDate(row.next_agenda_at)}</p><p className="mt-1 text-muted-foreground">Última señal Mail: {formatDate(row.last_event_at)}</p><p className="mt-1 text-muted-foreground">Sin próxima acción: {row.no_next_action_leads.toLocaleString("es-CL")}</p></div>
    </div>
  );
}
