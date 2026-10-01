"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, BriefcaseBusiness, Inbox, UsersRound } from "lucide-react";

export type WorkspaceTab = "operation" | "inbox" | "team" | "reports";

/** Pestañas subrayadas pegadas al contenido; la cifra marca trabajo pendiente. */
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
    <section className="space-y-4">
      <div role="tablist" aria-label="Vistas de correo" className="flex items-stretch gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          const count = tab.id === "team" ? attentionCount : tab.id === "inbox" ? inboxCount : 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              onClick={() => setActive(tab.id)}
              aria-selected={selected}
              className={`group relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon size={15} aria-hidden="true" />
              {tab.label}
              {count > 0 && (
                <span className={`rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums ${selected ? "bg-primary/15 text-primary" : "bg-surface-muted text-muted-foreground group-hover:text-foreground"}`}>
                  {count.toLocaleString("es-CL")}
                </span>
              )}
              <span aria-hidden="true" className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${selected ? "bg-primary" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{content}</div>
    </section>
  );
}
