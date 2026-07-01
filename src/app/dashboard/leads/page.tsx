import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import type { ComponentType } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, PhoneCall, Search } from "lucide-react";
import { LEAD_STATUSES } from "@/lib/types";

const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.label]));
const QUEUE_VIEWS = ["prioridad", "vencidas", "hoy", "disponibles", "bloqueados", "gestionados"] as const;

type QueueView = (typeof QUEUE_VIEWS)[number];

type LeadRow = {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  status: string;
  updated_at: string;
  next_action_at: string | null;
  tipificacion_actual: string | null;
  assignment_status: string | null;
  workflow_status: string | null;
  managed_at: string | null;
};

type QueueState = {
  label: string;
  detail: string;
  rank: number;
  tone: "danger" | "warning" | "primary" | "muted" | "success";
  icon: ComponentType<{ size?: number; className?: string }>;
};

function parseView(value: string | undefined): QueueView {
  return QUEUE_VIEWS.includes(value as QueueView) ? (value as QueueView) : "prioridad";
}

function hasPhone(lead: LeadRow) {
  return Boolean(lead.phone?.trim());
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function getQueueState(lead: LeadRow, now: Date): QueueState {
  const nextActionAt = lead.next_action_at ? new Date(lead.next_action_at) : null;
  const todayEnd = endOfToday();
  const managed = Boolean(lead.managed_at) || lead.assignment_status === "managed" || lead.workflow_status === "managed";

  if (!hasPhone(lead)) {
    return {
      label: "Bloqueado",
      detail: "Sin teléfono",
      rank: 0,
      tone: "danger",
      icon: AlertTriangle,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime()) && nextActionAt <= now) {
    return {
      label: "Urgente",
      detail: `Vencida: ${dateLabel(lead.next_action_at)}`,
      rank: 1,
      tone: "danger",
      icon: AlertTriangle,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime()) && nextActionAt <= todayEnd) {
    return {
      label: "Agenda hoy",
      detail: dateLabel(lead.next_action_at),
      rank: 2,
      tone: "warning",
      icon: CalendarClock,
    };
  }

  if (!managed) {
    return {
      label: "Disponible",
      detail: "Listo para gestionar",
      rank: 3,
      tone: "primary",
      icon: PhoneCall,
    };
  }

  if (nextActionAt && !Number.isNaN(nextActionAt.getTime())) {
    return {
      label: "Agenda futura",
      detail: dateLabel(lead.next_action_at),
      rank: 4,
      tone: "muted",
      icon: CalendarClock,
    };
  }

  return {
    label: "Gestionado",
    detail: lead.tipificacion_actual ?? "Sin próxima acción",
    rank: 5,
    tone: "success",
    icon: CheckCircle2,
  };
}

function stateClass(tone: QueueState["tone"]) {
  if (tone === "danger") return "bg-danger-bg text-danger";
  if (tone === "warning") return "bg-warning-bg text-warning";
  if (tone === "success") return "bg-success-bg text-success";
  if (tone === "primary") return "bg-primary text-primary-foreground";
  return "bg-surface-muted text-muted-foreground";
}

function viewHref(view: QueueView, q?: string) {
  const params = new URLSearchParams();
  if (view !== "prioridad") params.set("view", view);
  if (q?.trim()) params.set("q", q.trim());
  const query = params.toString();
  return query ? `/dashboard/leads?${query}` : "/dashboard/leads";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const profile = await requireProfile();
  const { q, view: viewParam } = await searchParams;
  const view = parseView(viewParam);
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(
      "id, full_name, rut, phone, status, updated_at, next_action_at, tipificacion_actual, assignment_status, workflow_status, managed_at"
    )
    .order("updated_at", { ascending: false })
    .limit(150);

  if (q && q.trim()) {
    const term = q.trim();
    query = query.or(`rut.ilike.%${term}%,phone.ilike.%${term}%,full_name.ilike.%${term}%`);
  }

  const { data: leads, error } = await query;
  const now = new Date();
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const rows = ((leads ?? []) as LeadRow[])
    .map((lead) => ({ lead, state: getQueueState(lead, now) }))
    .filter(({ lead, state }) => {
      if (view === "vencidas") return state.label === "Urgente";
      if (view === "hoy") {
        if (!lead.next_action_at) return false;
        const date = new Date(lead.next_action_at);
        return !Number.isNaN(date.getTime()) && date >= todayStart && date <= todayEnd;
      }
      if (view === "disponibles") return state.label === "Disponible";
      if (view === "bloqueados") return state.label === "Bloqueado";
      if (view === "gestionados") return state.label === "Gestionado";
      return true;
    })
    .sort((a, b) => {
      const rankDiff = a.state.rank - b.state.rank;
      if (rankDiff !== 0) return rankDiff;
      const aAgenda = a.lead.next_action_at ? new Date(a.lead.next_action_at).getTime() : Number.POSITIVE_INFINITY;
      const bAgenda = b.lead.next_action_at ? new Date(b.lead.next_action_at).getTime() : Number.POSITIVE_INFINITY;
      if (aAgenda !== bAgenda) return aAgenda - bAgenda;
      return new Date(b.lead.updated_at).getTime() - new Date(a.lead.updated_at).getTime();
    })
    .slice(0, 75);

  const states = ((leads ?? []) as LeadRow[]).map((lead) => getQueueState(lead, now));
  const counts = {
    vencidas: states.filter((state) => state.label === "Urgente").length,
    hoy: ((leads ?? []) as LeadRow[]).filter((lead) => {
      if (!lead.next_action_at) return false;
      const date = new Date(lead.next_action_at);
      return !Number.isNaN(date.getTime()) && date >= todayStart && date <= todayEnd;
    }).length,
    disponibles: states.filter((state) => state.label === "Disponible").length,
    bloqueados: states.filter((state) => state.label === "Bloqueado").length,
    gestionados: states.filter((state) => state.label === "Gestionado").length,
  };

  const tabs: { view: QueueView; label: string; count?: number }[] = [
    { view: "prioridad", label: "Prioridad", count: rows.length },
    { view: "vencidas", label: "Vencidas", count: counts.vencidas },
    { view: "hoy", label: "Hoy", count: counts.hoy },
    { view: "disponibles", label: "Disponibles", count: counts.disponibles },
    { view: "bloqueados", label: "Bloqueados", count: counts.bloqueados },
    { view: "gestionados", label: "Gestionados", count: counts.gestionados },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cola de gestión</h1>
          <p className="text-sm text-muted-foreground">
            Hola, {profile.full_name.split(" ")[0]}. Próximas gestiones ordenadas por urgencia.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QueueMetric label="Vencidas" value={counts.vencidas} tone="danger" />
          <QueueMetric label="Hoy" value={counts.hoy} tone="warning" />
          <QueueMetric label="Disponibles" value={counts.disponibles} tone="primary" />
          <QueueMetric label="Bloqueados" value={counts.bloqueados} tone="muted" />
        </div>
      </div>

      <form className="relative max-w-xl">
        {view !== "prioridad" && <input type="hidden" name="view" value={view} />}
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="RUT, teléfono o nombre..."
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.view === view;
          return (
            <Link
              key={tab.view}
              href={viewHref(tab.view, q)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/20" : "bg-surface-muted"}`}>
                  {tab.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Prioridad</th>
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Contacto</th>
              <th className="px-5 py-3 font-medium">Estado operativo</th>
              <th className="px-5 py-3 font-medium">Última gestión</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {error && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-danger">
                  Error al cargar leads: {error.message}
                </td>
              </tr>
            )}
            {!error && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                  No hay gestiones para este filtro.
                </td>
              </tr>
            )}
            {rows.map(({ lead, state }, index) => {
              const Icon = state.icon;
              return (
                <tr key={lead.id} className="hover:bg-surface-muted">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground">
                        {index + 1}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${stateClass(state.tone)}`}>
                        <Icon size={13} />
                        {state.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {lead.full_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {STATUS_LABEL[lead.status] ?? lead.status}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    <p>{lead.rut ?? "—"}</p>
                    <p className={hasPhone(lead) ? "" : "font-medium text-danger"}>{lead.phone ?? "Sin teléfono"}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-foreground">{state.detail}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Actualizado: {new Date(lead.updated_at).toLocaleDateString("es-CL")}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {lead.tipificacion_actual ?? (lead.managed_at ? "Gestionado" : "—")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        state.tone === "primary" || state.tone === "danger" || state.tone === "warning"
                          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                          : "border border-border text-foreground hover:bg-surface-muted"
                      }`}
                    >
                      {hasPhone(lead) ? "Gestionar" : "Revisar"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "primary" | "muted";
}) {
  const valueClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "primary"
          ? "text-primary"
          : "text-muted-foreground";

  return (
    <div className="min-w-24 rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
