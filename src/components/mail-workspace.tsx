"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, BriefcaseBusiness, UsersRound } from "lucide-react";

type WorkspaceTab = "operation" | "team" | "reports";

const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof BriefcaseBusiness }> = [
  { id: "operation", label: "Operación", icon: BriefcaseBusiness },
  { id: "team", label: "Equipo", icon: UsersRound },
  { id: "reports", label: "Reportes", icon: BarChart3 },
];

/** Mantiene una sola superficie de trabajo visible: no apila tres tableros. */
export function MailWorkspace({
  operation,
  team,
  reports,
  attentionCount,
}: {
  operation: ReactNode;
  team: ReactNode;
  reports: ReactNode;
  attentionCount: number;
}) {
  const [active, setActive] = useState<WorkspaceTab>("operation");
  const content = active === "operation" ? operation : active === "team" ? team : reports;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              aria-pressed={selected}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
            >
              <Icon size={16} aria-hidden />
              {tab.label}
              {tab.id === "team" && attentionCount > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selected ? "bg-primary-foreground/20" : "bg-danger-bg text-danger"}`}>{attentionCount}</span>}
            </button>
          );
        })}
      </div>
      {content}
    </section>
  );
}
