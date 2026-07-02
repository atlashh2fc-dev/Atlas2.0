"use client";

import { useMemo, useState } from "react";

export type SupervisorAgentMetric = {
  agent_id: string;
  full_name: string;
  team_name: string | null;
  is_historical_only?: boolean;
  crm_gestiones: number;
  llamadas_cerradas: number;
  leads_gestionados: number;
  contactos_efectivos: number;
  contactabilidad: number | null;
  no_contacto: number;
  agendas: number;
  cotizaciones: number;
  ventas: number;
  uf: number;
  tmo_seconds: number | null;
};

type SortKey =
  | "full_name"
  | "crm_gestiones"
  | "leads_gestionados"
  | "llamadas_cerradas"
  | "contactos_efectivos"
  | "contactabilidad"
  | "no_contacto"
  | "agendas"
  | "cotizaciones"
  | "ventas"
  | "uf"
  | "tmo_seconds";

type Scope = "all" | "active" | "historical";
type PriorityFilter =
  | "all"
  | "heavy_load"
  | "low_contact"
  | "no_contact"
  | "scheduled"
  | "commercial_opportunity"
  | "no_progress";

const columns: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "full_name", label: "Ejecutivo" },
  { key: "crm_gestiones", label: "Gestiones", align: "right" },
  { key: "leads_gestionados", label: "Leads", align: "right" },
  { key: "llamadas_cerradas", label: "Llamadas", align: "right" },
  { key: "contactos_efectivos", label: "Contactados", align: "right" },
  { key: "contactabilidad", label: "%", align: "right" },
  { key: "no_contacto", label: "No contacto", align: "right" },
  { key: "agendas", label: "Agendas", align: "right" },
  { key: "cotizaciones", label: "Cotizaciones", align: "right" },
  { key: "ventas", label: "Ventas", align: "right" },
  { key: "uf", label: "UF", align: "right" },
  { key: "tmo_seconds", label: "TMO", align: "right" },
];

const priorityFilters: {
  key: PriorityFilter;
  label: string;
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  matches: (agent: SupervisorAgentMetric) => boolean;
}[] = [
  {
    key: "all",
    label: "Todos",
    sortKey: "crm_gestiones",
    sortDirection: "desc",
    matches: () => true,
  },
  {
    key: "heavy_load",
    label: "Mayor carga",
    sortKey: "leads_gestionados",
    sortDirection: "desc",
    matches: (agent) => agent.leads_gestionados > 0 || agent.crm_gestiones > 0,
  },
  {
    key: "low_contact",
    label: "Baja contactabilidad",
    sortKey: "contactabilidad",
    sortDirection: "asc",
    matches: (agent) => agent.llamadas_cerradas > 0 && numberValue(agent.contactabilidad) < 35,
  },
  {
    key: "no_contact",
    label: "No contacto",
    sortKey: "no_contacto",
    sortDirection: "desc",
    matches: (agent) => agent.no_contacto > 0,
  },
  {
    key: "scheduled",
    label: "Agendas",
    sortKey: "agendas",
    sortDirection: "desc",
    matches: (agent) => agent.agendas > 0,
  },
  {
    key: "commercial_opportunity",
    label: "Oportunidad comercial",
    sortKey: "contactos_efectivos",
    sortDirection: "desc",
    matches: (agent) => agent.contactos_efectivos > 0 && agent.ventas === 0,
  },
  {
    key: "no_progress",
    label: "Sin avance",
    sortKey: "crm_gestiones",
    sortDirection: "asc",
    matches: (agent) => agent.crm_gestiones === 0 || agent.llamadas_cerradas === 0,
  },
];

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function formatNumber(value: number | null | undefined) {
  return Math.round(Number(value ?? 0)).toLocaleString("es-CL");
}

function formatDecimal(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("es-CL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${formatDecimal(value)}%`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function metricValue(agent: SupervisorAgentMetric, key: SortKey): number | string {
  if (key === "full_name") return agent.full_name;
  return numberValue(agent[key]);
}

function cellValue(agent: SupervisorAgentMetric, key: SortKey): string {
  if (key === "full_name") return agent.full_name;
  if (key === "contactabilidad") return formatPercent(agent.contactabilidad);
  if (key === "uf") return formatDecimal(agent.uf, 2);
  if (key === "tmo_seconds") return formatDuration(agent.tmo_seconds);
  return formatNumber(agent[key]);
}

export function SupervisorAgentMetricsTable({ agents }: { agents: SupervisorAgentMetric[] }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [priority, setPriority] = useState<PriorityFilter>("heavy_load");
  const [sortKey, setSortKey] = useState<SortKey>("leads_gestionados");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const activePriority =
    priorityFilters.find((filter) => filter.key === priority) ?? priorityFilters[0];

  const visibleAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...agents]
      .filter((agent) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          agent.full_name.toLowerCase().includes(normalizedQuery) ||
          (agent.team_name ?? "").toLowerCase().includes(normalizedQuery);
        const matchesScope =
          scope === "all" ||
          (scope === "historical" ? agent.is_historical_only : !agent.is_historical_only);
        return matchesQuery && matchesScope && activePriority.matches(agent);
      })
      .sort((a, b) => {
        const left = metricValue(a, sortKey);
        const right = metricValue(b, sortKey);
        if (typeof left === "string" || typeof right === "string") {
          return sortDirection === "asc"
            ? String(left).localeCompare(String(right), "es-CL")
            : String(right).localeCompare(String(left), "es-CL");
        }
        return sortDirection === "asc" ? left - right : right - left;
      });
  }, [activePriority, agents, query, scope, sortDirection, sortKey]);

  const selectPriority = (filter: (typeof priorityFilters)[number]) => {
    setPriority(filter.key);
    setSortKey(filter.sortKey);
    setSortDirection(filter.sortDirection);
  };

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "full_name" ? "asc" : "desc");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="space-y-3 border-b border-border p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar ejecutivo o equipo..."
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="historical">Históricos</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Priorizar</span>
          {priorityFilters.map((filter) => {
            const isActive = priority === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => selectPriority(filter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatNumber(visibleAgents.length)} ejecutivos
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-5 py-3 font-medium ${column.align === "right" ? "text-right" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setSort(column.key)}
                    className={`inline-flex items-center gap-1 rounded-md text-xs font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      column.align === "right" ? "justify-end" : ""
                    }`}
                  >
                    <span>{column.label}</span>
                    {sortKey === column.key && (
                      <span className="text-[11px] text-primary">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleAgents.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-5 py-6 text-center text-muted-foreground">
                  Sin ejecutivos para los filtros aplicados.
                </td>
              </tr>
            )}
            {visibleAgents.map((agent) => (
              <tr key={agent.agent_id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-5 py-3 ${
                      column.align === "right" ? "text-right text-muted-foreground" : "font-medium text-foreground"
                    }`}
                  >
                    {column.key === "full_name" ? (
                      <>
                        <span>{agent.full_name}</span>
                        {agent.is_historical_only && (
                          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Histórico
                          </span>
                        )}
                      </>
                    ) : (
                      cellValue(agent, column.key)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
