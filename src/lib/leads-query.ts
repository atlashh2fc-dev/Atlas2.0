import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "./types";

/**
 * Consulta única de la cola de registros, con las vistas operativas resueltas
 * **en el servidor**. Antes las vistas se calculaban sobre las primeras 300
 * filas cargadas y la tabla cortaba en 75 sin avisar: los contadores de las
 * pestañas eran, por lo tanto, falsos en cualquier base grande.
 *
 * La visibilidad la garantiza la política RLS `leads_select` (admin ve todo,
 * supervisor su equipo, ejecutivo lo propio o lo no asignado de su equipo),
 * así que consultar `leads` directamente es equivalente a la RPC anterior y
 * además permite `count` y `range` reales.
 */

export const LEAD_VIEWS = [
  { id: "prioridad", label: "Prioridad" },
  { id: "vencidas", label: "Vencidas" },
  { id: "hoy", label: "Hoy" },
  { id: "disponibles", label: "Disponibles" },
  { id: "bloqueados", label: "Bloqueados" },
  { id: "gestionados", label: "Gestionados" },
] as const;

export type LeadView = (typeof LEAD_VIEWS)[number]["id"];

export const LEAD_SELECT =
  "id, full_name, rut, phone, status, assigned_to, managed_by, team_id, campaign_id, updated_at, next_action_at, tipificacion_actual, assignment_status, workflow_status, managed_at";

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 250;

export type LeadFilters = {
  q: string;
  agent: string;
  campaign: string;
  status: string;
};

export function parseLeadView(value: string | undefined): LeadView {
  return LEAD_VIEWS.some((view) => view.id === value) ? (value as LeadView) : "prioridad";
}

function dayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString(), now: new Date().toISOString() };
}

/** `managed` en SQL: gestionado por fecha o por estado de asignación/flujo. */
const MANAGED_OR = "managed_at.not.is.null,assignment_status.eq.managed,workflow_status.eq.managed";
const NO_PHONE_OR = "phone.is.null,phone.eq.";

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Aplica a una consulta las condiciones de la vista operativa. */
function applyView(query: Query, view: LeadView) {
  const { start, end, now } = dayBounds();

  if (view === "bloqueados") return query.or(NO_PHONE_OR);

  // El resto de las vistas exige teléfono utilizable.
  const withPhone = query.not("phone", "is", null).neq("phone", "");

  if (view === "vencidas") return withPhone.lte("next_action_at", now);
  if (view === "hoy") return withPhone.gte("next_action_at", start).lte("next_action_at", end);
  if (view === "gestionados") return withPhone.is("next_action_at", null).or(MANAGED_OR);
  if (view === "disponibles")
    return withPhone
      // El valor va entre comillas: la marca de tiempo ISO contiene puntos y
      // dos puntos, que PostgREST usa como separadores dentro de `or`.
      .or(`next_action_at.is.null,next_action_at.gt."${end}"`)
      .is("managed_at", null)
      .or("assignment_status.is.null,assignment_status.neq.managed")
      .or("workflow_status.is.null,workflow_status.neq.managed");

  return query;
}

function applyFilters(query: Query, filters: LeadFilters, ids: string[] | null) {
  if (ids) query = query.in("id", ids);
  if (filters.agent) query = query.or(`assigned_to.eq.${filters.agent},managed_by.eq.${filters.agent}`);
  if (filters.campaign) query = query.eq("campaign_id", filters.campaign);
  if (filters.status) query = query.eq("status", filters.status);
  return query;
}

export type LeadsPage<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: Record<LeadView, number>;
  /** Estados realmente presentes en la selección, para no ofrecer filtros vacíos. */
  statuses: string[];
  error: string | null;
};

type ViewCounts = Record<LeadView, number> & { estados: string[] };

export async function fetchLeadsPage<T>(
  supabase: SupabaseClient,
  options: {
    role: AppRole;
    filters: LeadFilters;
    view: LeadView;
    page: number;
    pageSize: number;
  }
): Promise<LeadsPage<T>> {
  const { filters, view } = options;
  const pageSize = Math.min(Math.max(1, options.pageSize), PAGE_SIZE_MAX);

  // La búsqueda por texto sigue pasando por la RPC, que aplica las reglas de
  // coincidencia por RUT/teléfono/nombre; sus ids acotan la consulta.
  let ids: string[] | null = null;
  if (filters.q) {
    const { data, error } = await supabase.rpc("search_leads_quick", { p_term: filters.q });
    if (error) {
      return {
        rows: [],
        total: 0,
        page: 1,
        pageSize,
        pageCount: 1,
        counts: emptyCounts(),
        statuses: [],
        error: error.message,
      };
    }
    ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
    if (ids.length === 0) {
      return {
        rows: [],
        total: 0,
        page: 1,
        pageSize,
        pageCount: 1,
        counts: emptyCounts(),
        statuses: [],
        error: null,
      };
    }
  }

  const [countsResult, listing] = await Promise.all([
    // Los seis contadores en un solo recorrido, en vez de seis `count exact`
    // sobre una tabla de decenas de miles de filas.
    supabase.rpc("get_lead_view_counts", {
      p_agent: filters.agent || null,
      p_campaign: filters.campaign || null,
      p_status: filters.status || null,
      p_ids: ids,
    }),
    (async () => {
      const base = applyFilters(supabase.from("leads").select(LEAD_SELECT, { count: "exact" }), filters, ids);
      const scoped = applyView(base, view);
      const page = Math.max(1, options.page);
      const from = (page - 1) * pageSize;
      const { data, count, error } = await scoped
        // Aproxima la prioridad operativa: primero lo que tiene agenda más
        // antigua (vencido), y al final lo que no tiene agenda.
        .order("next_action_at", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .range(from, from + pageSize - 1);
      return { rows: (data ?? []) as T[], total: count ?? 0, page, error: error?.message ?? null };
    })(),
  ]);

  const total = listing.total;
  const viewCounts = (countsResult.data ?? null) as ViewCounts | null;

  return {
    rows: listing.rows,
    total,
    page: listing.page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    counts: viewCounts
      ? (Object.fromEntries(LEAD_VIEWS.map((item) => [item.id, viewCounts[item.id] ?? 0])) as Record<LeadView, number>)
      : emptyCounts(),
    statuses: viewCounts?.estados ?? [],
    error: listing.error ?? countsResult.error?.message ?? null,
  };
}

function emptyCounts(): Record<LeadView, number> {
  return Object.fromEntries(LEAD_VIEWS.map((item) => [item.id, 0])) as Record<LeadView, number>;
}
