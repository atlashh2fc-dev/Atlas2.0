"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ExternalLink, FileText, Loader2, Mail, Phone, ShoppingCart, X } from "lucide-react";
import { Input, Select, buttonClasses } from "@/components/ui";

export type SupervisorAgentMetric = {
  agent_id: string;
  profile_id?: string | null;
  historical_agent_id?: string | null;
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
type DrilldownMetric = "agendas" | "cotizaciones" | "ventas";
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

const drilldownColumns = new Set<SortKey>(["agendas", "cotizaciones", "ventas"]);

const metricLabels: Record<DrilldownMetric, string> = {
  agendas: "Agendas",
  cotizaciones: "Cotizaciones",
  ventas: "Ventas",
};

type DrilldownContact = {
  id: string;
  contact_type: "phone" | "email";
  value: string;
  label: string | null;
  is_primary: boolean;
  is_valid: boolean | null;
};

type DrilldownItem = {
  call_id: string;
  lead_id: string;
  activity_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: string | null;
  outcome: string | null;
  reason: string | null;
  notes: string | null;
  next_action_at: string | null;
  equifax_products: string[] | null;
  equifax_uf_amount: number | null;
  equifax_recipient_email: string | null;
  agent_name: string;
  lead: {
    id: string;
    full_name: string;
    rut: string | null;
    phone: string | null;
    email: string | null;
    status: string | null;
    tipificacion_actual: string | null;
    observacion_actual: string | null;
    next_action_at: string | null;
    managed_at: string | null;
    campaign_name: string | null;
  };
  contacts: DrilldownContact[];
};

type DrilldownPayload = {
  metric: DrilldownMetric;
  limit: number;
  items: DrilldownItem[];
};

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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-CL");
}

function getMetricIcon(metric: DrilldownMetric) {
  if (metric === "agendas") return CalendarClock;
  if (metric === "cotizaciones") return FileText;
  return ShoppingCart;
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

export function SupervisorAgentMetricsTable({
  agents,
  rangeFrom,
  rangeTo,
}: {
  agents: SupervisorAgentMetric[];
  rangeFrom: string;
  rangeTo: string;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [priority, setPriority] = useState<PriorityFilter>("heavy_load");
  const [sortKey, setSortKey] = useState<SortKey>("leads_gestionados");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [drilldown, setDrilldown] = useState<{ agent: SupervisorAgentMetric; metric: DrilldownMetric } | null>(null);
  const [payload, setPayload] = useState<DrilldownPayload | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activePriority =
    priorityFilters.find((filter) => filter.key === priority) ?? priorityFilters[0];
  const selectedItem =
    payload?.items.find((item) => item.call_id === selectedCallId) ?? payload?.items[0] ?? null;

  useEffect(() => {
    if (!drilldown) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      metric: drilldown.metric,
      from: rangeFrom,
      to: rangeTo,
    });
    if (drilldown.agent.profile_id) params.set("profileId", drilldown.agent.profile_id);
    if (drilldown.agent.historical_agent_id) {
      params.set("historicalAgentId", drilldown.agent.historical_agent_id);
    }

    fetch(`/api/reportes/supervisor-drilldown?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el detalle.");
        return body as DrilldownPayload;
      })
      .then((body) => {
        setPayload(body);
        setSelectedCallId(body.items[0]?.call_id ?? null);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [drilldown, rangeFrom, rangeTo]);

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

  const openDrilldown = (agent: SupervisorAgentMetric, metric: DrilldownMetric) => {
    setPayload(null);
    setSelectedCallId(null);
    setLoadError(null);
    setLoading(true);
    setDrilldown({ agent, metric });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="space-y-3 border-b border-border p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar ejecutivo o equipo..."
          />
          <Select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="historical">Históricos</option>
          </Select>
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
                    ) : drilldownColumns.has(column.key) && numberValue(agent[column.key]) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openDrilldown(agent, column.key as DrilldownMetric)}
                        className="rounded-md px-2 py-1 font-medium text-primary hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`Ver detalle de ${column.label.toLowerCase()}`}
                      >
                        {cellValue(agent, column.key)}
                      </button>
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

      {drilldown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {metricLabels[drilldown.metric]} · {drilldown.agent.full_name}
                </p>
                <h3 className="text-lg font-semibold text-foreground">Detalle de gestiones</h3>
              </div>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Cerrar detalle"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_1fr]">
              <div className="min-h-0 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
                {loading && (
                  <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Cargando detalle...
                  </div>
                )}
                {loadError && <div className="p-5 text-sm text-danger">{loadError}</div>}
                {!loading && !loadError && payload?.items.length === 0 && (
                  <div className="p-5 text-sm text-muted-foreground">Sin gestiones para este filtro.</div>
                )}
                {!loading &&
                  !loadError &&
                  payload?.items.map((item) => {
                    const Icon = getMetricIcon(drilldown.metric);
                    const isActive = selectedItem?.call_id === item.call_id;
                    return (
                      <button
                        key={item.call_id}
                        type="button"
                        onClick={() => setSelectedCallId(item.call_id)}
                        className={`block w-full border-b border-border px-5 py-4 text-left transition ${
                          isActive ? "bg-surface-muted" : "hover:bg-surface-muted/70"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 rounded-lg bg-background p-2 text-primary">
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {item.lead.full_name}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {item.reason ?? item.outcome ?? "Gestión"} · {formatDateTime(item.activity_at)}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {item.lead.rut ?? "Sin RUT"} · {item.contacts.length} contacto(s)
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>

              <div className="min-h-0 overflow-y-auto p-5">
                {!selectedItem && !loading && (
                  <div className="text-sm text-muted-foreground">Selecciona una gestión para ver el detalle.</div>
                )}

                {selectedItem && (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-xl font-semibold text-foreground">{selectedItem.lead.full_name}</h4>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {selectedItem.lead.rut ?? "Sin RUT"} · {selectedItem.lead.campaign_name ?? "Sin campaña"}
                        </p>
                      </div>
                      <a href={`/dashboard/leads/${selectedItem.lead_id}`} className={buttonClasses()}>
                        Abrir ficha 360
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Última tipificación</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {selectedItem.lead.tipificacion_actual ?? selectedItem.reason ?? "-"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">Próxima agenda</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {formatDateTime(selectedItem.lead.next_action_at ?? selectedItem.next_action_at)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3">
                        <p className="text-xs text-muted-foreground">UF / Venta</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {selectedItem.equifax_uf_amount
                            ? `UF ${formatDecimal(selectedItem.equifax_uf_amount, 2)}`
                            : "-"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                      <h5 className="text-sm font-semibold text-foreground">Contactos</h5>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {selectedItem.contacts.length === 0 && (
                          <p className="text-sm text-muted-foreground">Sin contactos normalizados.</p>
                        )}
                        {selectedItem.contacts.map((contact) => {
                          const ContactIcon = contact.contact_type === "phone" ? Phone : Mail;
                          return (
                            <div key={contact.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                              <ContactIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">{contact.value}</p>
                                <p className="text-xs text-muted-foreground">
                                  {contact.contact_type === "phone" ? "Teléfono" : "Email"}
                                  {contact.is_primary ? " · Principal" : ""}
                                  {contact.is_valid === false ? " · Inválido" : ""}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background p-4">
                      <h5 className="text-sm font-semibold text-foreground">Gestión seleccionada</h5>
                      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">Fecha gestión</dt>
                          <dd className="text-foreground">{formatDateTime(selectedItem.activity_at)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Ejecutivo</dt>
                          <dd className="text-foreground">{selectedItem.agent_name}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Estado / resultado</dt>
                          <dd className="text-foreground">
                            {[selectedItem.status, selectedItem.outcome].filter(Boolean).join(" / ") || "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Motivo</dt>
                          <dd className="text-foreground">{selectedItem.reason ?? "-"}</dd>
                        </div>
                      </dl>
                      {(selectedItem.notes || selectedItem.lead.observacion_actual) && (
                        <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-muted-foreground">
                          {selectedItem.notes ?? selectedItem.lead.observacion_actual}
                        </p>
                      )}
                      {selectedItem.equifax_products && selectedItem.equifax_products.length > 0 && (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Productos: {selectedItem.equifax_products.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
