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
  const [sortKey, setSortKey] = useState<SortKey>("crm_gestiones");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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
        return matchesQuery && matchesScope;
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
  }, [agents, query, scope, sortDirection, sortKey]);

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
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_180px_220px]">
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
        <select
          value={`${sortKey}:${sortDirection}`}
          onChange={(event) => {
            const [key, direction] = event.target.value.split(":") as [SortKey, "asc" | "desc"];
            setSortKey(key);
            setSortDirection(direction);
          }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {columns.map((column) => (
            <option key={`${column.key}:desc`} value={`${column.key}:desc`}>
              {column.label} mayor a menor
            </option>
          ))}
          {columns.map((column) => (
            <option key={`${column.key}:asc`} value={`${column.key}:asc`}>
              {column.label} menor a mayor
            </option>
          ))}
        </select>
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
                      <span className="text-[10px] uppercase text-primary">{sortDirection}</span>
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
