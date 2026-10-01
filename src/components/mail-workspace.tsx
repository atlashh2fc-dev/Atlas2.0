"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, BriefcaseBusiness, Inbox, UsersRound } from "lucide-react";

export type WorkspaceTab = "operation" | "inbox" | "team" | "reports";

/** Cada pestaña lleva el tono de su dominio: colas en rosa, buzón en verde azulado, equipo en azul, reportes en violeta. */
const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof BriefcaseBusiness; tone: "rose" | "teal" | "blue" | "violet" }> = [
  { id: "operation", label: "Operación", icon: BriefcaseBusiness, tone: "rose" },
  { id: "inbox", label: "Buzón", icon: Inbox, tone: "teal" },
  { id: "team", label: "Equipo", icon: UsersRound, tone: "blue" },
  { id: "reports", label: "Reportes", icon: BarChart3, tone: "violet" },
];

/**
 * Mantiene una sola superficie de trabajo visible: no apila tableros. Buzón es
 * la casilla de la cuenta (cotizaciones y respuestas del ejecutivo); Operación,
 * la cola de las campañas masivas.
 */
export function MailWorkspace({
  operation,
  inbox,
  team,
  reports,
  attentionCount,
  inboxCount,
  initialTab = "operation",
}: {
  operation: ReactNode;
  inbox: ReactNode;
  team: ReactNode;
  reports: ReactNode;
  attentionCount: number;
  inboxCount: number;
  initialTab?: WorkspaceTab;
}) {
  const [active, setActive] = useState<WorkspaceTab>(initialTab);
  const content = active === "operation" ? operation : active === "inbox" ? inbox : active === "team" ? team : reports;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              aria-pressed={selected}
              className={`inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${selected ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
            >
              <Icon size={16} aria-hidden="true" />
              {tab.label}
              {tab.id === "team" && attentionCount > 0 && <span className="text-xs font-semibold tabular-nums text-primary">{attentionCount}</span>}
              {tab.id === "inbox" && inboxCount > 0 && <span className="text-xs font-semibold tabular-nums text-primary">{inboxCount}</span>}
            </button>
          );
        })}
      </div>
      {content}
    </section>
  );
}
