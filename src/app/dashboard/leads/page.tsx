import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Search } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";
import { LeadsQueue, type LeadQueueRow, type LeadQueueView } from "@/components/leads-queue";

const QUEUE_VIEWS = ["prioridad", "vencidas", "hoy", "disponibles", "bloqueados", "gestionados"] as const;

type FilterOption = {
  id: string;
  full_name?: string;
  name?: string;
};

function parseView(value: string | undefined): LeadQueueView {
  return QUEUE_VIEWS.includes(value as LeadQueueView) ? (value as LeadQueueView) : "prioridad";
}

function roleCopy(role: string) {
  if (role === "supervisor") {
    return {
      title: "Cola del equipo",
      description: "Leads visibles de tu equipo, filtrados por prioridad, ejecutivo y campaña.",
      action: "Revisar",
    };
  }
  if (role === "admin") {
    return {
      title: "Cola global",
      description: "Vista global de leads para auditoría, búsqueda y control operacional.",
      action: "Abrir",
    };
  }
  return {
    title: "Mi cola de gestión",
    description: "Tus próximas gestiones ordenadas por urgencia.",
    action: "Gestionar",
  };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; agent?: string; campaign?: string; status?: string }>;
}) {
  const profile = await requireProfile();
  const { q, view: viewParam, agent, campaign, status } = await searchParams;
  const view = parseView(viewParam);
  const supabase = await createClient();
  const copy = roleCopy(profile.role);
  const canFilterOperation = profile.role === "supervisor" || profile.role === "admin";
  const filters = {
    q: q?.trim() || "",
    agent: canFilterOperation ? agent || "" : "",
    campaign: canFilterOperation ? campaign || "" : "",
    status: canFilterOperation ? status || "" : "",
  };
  const agentSearchVisibilityFilter = profile.team_id
    ? `assigned_to.eq.${profile.id},managed_by.eq.${profile.id},and(assigned_to.is.null,managed_by.is.null,team_id.eq.${profile.team_id})`
    : `assigned_to.eq.${profile.id},managed_by.eq.${profile.id}`;
  const agentQueueVisibilityFilter = `assigned_to.eq.${profile.id},managed_by.eq.${profile.id}`;

  const [{ data: agentOptions }, { data: campaignOptions }] = canFilterOperation
    ? await Promise.all([
        profile.role === "supervisor" && profile.team_id
          ? supabase
              .from("profiles")
              .select("id, full_name")
              .eq("team_id", profile.team_id)
              .eq("role", "agente")
              .order("full_name")
          : supabase.from("profiles").select("id, full_name").eq("role", "agente").order("full_name"),
        supabase.from("campaigns").select("id, name").order("name"),
      ])
    : [{ data: [] }, { data: [] }];

  let leads: LeadQueueRow[] = [];
  let error: { message: string } | null = null;

  const leadSelect =
    "id, full_name, rut, phone, status, assigned_to, managed_by, team_id, campaign_id, updated_at, next_action_at, tipificacion_actual, assignment_status, workflow_status, managed_at";

  if (filters.q) {
    const { data: matches, error: searchError } = await supabase.rpc("search_leads_quick", { p_term: filters.q });
    error = searchError;

    const ids = ((matches ?? []) as { id: string }[]).map((lead) => lead.id);
    if (!error && ids.length > 0) {
      const matchedQuery = supabase
        .from("leads")
        .select(leadSelect)
        .in("id", ids);
      if (profile.role === "agente") matchedQuery.or(agentSearchVisibilityFilter);
      if (profile.role === "supervisor" && profile.team_id) matchedQuery.eq("team_id", profile.team_id);
      if (filters.agent) matchedQuery.or(`assigned_to.eq.${filters.agent},managed_by.eq.${filters.agent}`);
      if (filters.campaign) matchedQuery.eq("campaign_id", filters.campaign);
      if (filters.status) matchedQuery.eq("status", filters.status);

      const { data: matchedLeads, error: leadsError } = await matchedQuery;
      leads = (matchedLeads ?? []) as LeadQueueRow[];
      error = leadsError;
    }
  } else {
    const queueQuery = supabase
      .from("leads")
      .select(leadSelect)
      .order("updated_at", { ascending: false });
    if (profile.role === "agente") queueQuery.or(agentQueueVisibilityFilter);
    if (profile.role === "supervisor" && profile.team_id) queueQuery.eq("team_id", profile.team_id);
    if (filters.agent) queueQuery.or(`assigned_to.eq.${filters.agent},managed_by.eq.${filters.agent}`);
    if (filters.campaign) queueQuery.eq("campaign_id", filters.campaign);
    if (filters.status) queueQuery.eq("status", filters.status);

    const { data: queueLeads, error: queueError } = await queueQuery.limit(profile.role === "admin" ? 300 : 200);
    leads = (queueLeads ?? []) as LeadQueueRow[];
    error = queueError;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">
            Hola, {profile.full_name.split(" ")[0]}. {copy.description}
          </p>
        </div>
      </div>

      <form className="grid gap-3 rounded-xl border border-border bg-surface p-4 lg:grid-cols-[minmax(240px,1fr)_repeat(3,minmax(160px,220px))_auto]">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="RUT, teléfono o nombre..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {canFilterOperation && (
          <>
            <select
              name="agent"
              defaultValue={filters.agent}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todos los ejecutivos</option>
              {((agentOptions ?? []) as FilterOption[]).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.full_name}
                </option>
              ))}
            </select>
            <select
              name="campaign"
              defaultValue={filters.campaign}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todas las campañas</option>
              {((campaignOptions ?? []) as FilterOption[]).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={filters.status}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todos los estados</option>
              {LEAD_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Filtrar
        </button>
      </form>

      <LeadsQueue leads={leads} initialView={view} copy={copy} errorMessage={error?.message ?? null} />
    </div>
  );
}
