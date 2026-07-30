"use client";

import { useEffect, useMemo, useState } from "react";
import { getAgentLiveStatus, getQueueHealth } from "@/app/actions/supervision";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";
import { LEGAL_INTERCALL_BREAK_SECONDS } from "@/lib/intercall-break";
import {
  Card,
  DataTable,
  Field,
  InfoTooltip,
  Input,
  MetricCard,
  SectionCard,
  Select,
  StatusDot,
  type BadgeTone,
  type Column,
} from "@/components/ui";

const POLL_MS = 2000;

/** Umbrales operativos: sobre estos valores el estado se marca en rojo. */
const THRESHOLDS = {
  /** Pausa prolongada. */
  pauseSeconds: 15 * 60,
  /** Cierre de llamada (ACW) que se alarga más de lo razonable. */
  wrapUpSeconds: 120,
  /** Abandono sobre el total contestado; sobre esto hay riesgo normativo. */
  abandonRate: 6,
};

type AgentGroup = "available" | "on_call" | "wrap_up" | "paused" | "offline";

const GROUP_LABEL: Record<AgentGroup, string> = {
  available: "Disponibles",
  on_call: "En llamada",
  wrap_up: "En cierre",
  paused: "En pausa",
  offline: "Sin conexión",
};

function elapsedSeconds(sinceIso: string | null, now: number): number | null {
  if (!sinceIso) return null;
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return null;
  return Math.max(0, Math.floor((now - since) / 1000));
}

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function groupOf(agent: AgentLiveStatus): AgentGroup {
  if (agent.phone_status === "on_call" || agent.phone_status === "ringing") return "on_call";
  if (agent.is_pause) return "paused";
  if (agent.phone_status === "wrap_up") return "wrap_up";
  if (agent.phone_status === "available") return "available";
  return "offline";
}

function agentDisplay(
  agent: AgentLiveStatus,
  now: number
): { label: string; tone: BadgeTone; since: string | null; alert: boolean } {
  if (agent.phone_status === "on_call")
    return { label: "En llamada", tone: "info", since: agent.phone_status_since, alert: false };
  if (agent.phone_status === "ringing")
    return { label: "Timbrando", tone: "warning", since: agent.phone_status_since, alert: false };

  if (agent.is_pause && agent.reason_label) {
    const seconds = elapsedSeconds(agent.reason_since, now);
    return {
      label: agent.reason_label,
      tone: "danger",
      since: agent.reason_since,
      alert: seconds != null && seconds > THRESHOLDS.pauseSeconds,
    };
  }

  if (agent.phone_status === "wrap_up") {
    const seconds = elapsedSeconds(agent.phone_status_since, now) ?? LEGAL_INTERCALL_BREAK_SECONDS;
    const inLegalBreak = seconds < LEGAL_INTERCALL_BREAK_SECONDS;
    return {
      label: inLegalBreak
        ? `Interrupción legal · ${LEGAL_INTERCALL_BREAK_SECONDS - seconds}s`
        : "Cierre de llamada pendiente",
      tone: "warning",
      since: agent.phone_status_since,
      alert: !inLegalBreak && seconds > THRESHOLDS.wrapUpSeconds,
    };
  }

  if (agent.phone_status === "available")
    return {
      label: "Disponible",
      tone: "success",
      since: agent.reason_since ?? agent.phone_status_since,
      alert: false,
    };

  return { label: "Sin conexión", tone: "neutral", since: null, alert: false };
}

function QueueHealthCard({ queue }: { queue: QueueHealth }) {
  const handled = queue.answered_today + queue.abandoned_today;
  const abandonRate = handled > 0 ? Math.round((queue.abandoned_today / handled) * 100) : 0;
  const overThreshold = abandonRate > THRESHOLDS.abandonRate;

  return (
    <Card>
      <p className="text-sm font-medium text-foreground">{queue.campaign_name}</p>
      <p className="text-xs text-muted-foreground">Cola: {queue.queue_name}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xl font-semibold tabular-nums text-foreground">{queue.in_flight}</p>
          <p className="text-[11px] text-muted-foreground">En curso ahora</p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums text-foreground">{queue.answered_today}</p>
          <p className="text-[11px] text-muted-foreground">Contestadas hoy</p>
        </div>
        <div>
          <p className={`text-xl font-semibold tabular-nums ${overThreshold ? "text-danger" : "text-foreground"}`}>
            {queue.abandoned_today}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Abandonadas ({abandonRate}%)
            <InfoTooltip
              text={`Llamadas conectadas que nadie atendió. Sobre ${THRESHOLDS.abandonRate}% hay riesgo normativo.`}
            />
          </p>
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums text-foreground">{queue.no_answer_today}</p>
          <p className="text-[11px] text-muted-foreground">No contesta hoy</p>
        </div>
      </div>
    </Card>
  );
}

export function LiveMonitor() {
  const [agents, setAgents] = useState<AgentLiveStatus[]>([]);
  const [queues, setQueues] = useState<QueueHealth[]>([]);
  const [now, setNow] = useState(() => new Date().getTime());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<AgentGroup | "">("");
  const [campaign, setCampaign] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    let disposed = false;

    async function poll() {
      try {
        const [liveAgents, liveQueues] = await Promise.all([getAgentLiveStatus(), getQueueHealth()]);
        if (disposed) return;
        setAgents(liveAgents);
        setQueues(liveQueues);
        setError(null);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Error al cargar el monitor");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const groups = useMemo(() => {
    const counters: Record<AgentGroup, number> = {
      available: 0,
      on_call: 0,
      wrap_up: 0,
      paused: 0,
      offline: 0,
    };
    for (const agent of agents) counters[groupOf(agent)] += 1;
    return counters;
  }, [agents]);

  const connected = agents.length - groups.offline;
  const occupancy = connected > 0 ? Math.round(((groups.on_call + groups.wrap_up) / connected) * 100) : 0;

  const campaignOptions = useMemo(
    () => [...new Set(agents.map((agent) => agent.campaign_name).filter((name): name is string => Boolean(name)))].sort(),
    [agents]
  );

  const normalizedTerm = term.trim().toLocaleLowerCase("es-CL");
  const filteredAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (group && groupOf(agent) !== group) return false;
        if (campaign && agent.campaign_name !== campaign) return false;
        if (normalizedTerm) {
          const haystack = `${agent.full_name} ${agent.extension}`.toLocaleLowerCase("es-CL");
          if (!haystack.includes(normalizedTerm)) return false;
        }
        return true;
      }),
    [agents, group, campaign, normalizedTerm]
  );

  const columns = useMemo<Column<AgentLiveStatus>[]>(
    () => [
      { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
      { id: "extension", header: "Extensión", value: (row) => row.extension, className: "text-muted-foreground" },
      {
        id: "campana",
        header: "Campaña",
        value: (row) => row.campaign_name ?? "",
        cell: (row) => row.campaign_name ?? "—",
        className: "text-muted-foreground",
      },
      {
        id: "estado",
        header: "Estado",
        value: (row) => agentDisplay(row, now).label,
        cell: (row) => {
          const { label, tone } = agentDisplay(row, now);
          return (
            <span className="inline-flex items-center gap-2">
              <StatusDot tone={tone} />
              {label}
            </span>
          );
        },
      },
      {
        id: "tiempo",
        header: "Tiempo en estado",
        align: "right",
        value: (row) => elapsedSeconds(agentDisplay(row, now).since, now) ?? -1,
        cell: (row) => {
          const { since, alert } = agentDisplay(row, now);
          const seconds = elapsedSeconds(since, now);
          return (
            <span className={alert ? "font-medium text-danger" : "tabular-nums"}>
              {formatElapsed(seconds)}
              {alert && " ⚠"}
            </span>
          );
        },
      },
    ],
    [now]
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando monitor…</p>;
  }

  if (error) {
    return <p className="text-sm text-danger">Error: {error}</p>;
  }

  const alerts = filteredAgents.filter((agent) => agentDisplay(agent, now).alert).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Ocupación del equipo"
          metric="ocupacion"
          value={`${occupancy}%`}
          hint={`${connected} conectados`}
          tone={occupancy >= 85 ? "warn" : "default"}
        />
        {(Object.keys(GROUP_LABEL) as AgentGroup[]).map((key) => (
          <MetricCard
            key={key}
            label={GROUP_LABEL[key]}
            value={groups[key]}
            tone={key === "paused" && groups.paused > 0 ? "warn" : "default"}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {queues.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay campañas activas para el motor de discado.</p>
        )}
        {queues.map((queue) => (
          <QueueHealthCard key={queue.campaign_id} queue={queue} />
        ))}
      </div>

      <SectionCard
        title={`Ejecutivos (${filteredAgents.length})`}
        description={
          alerts > 0
            ? `${alerts} sobre el umbral: pausa mayor a ${THRESHOLDS.pauseSeconds / 60} minutos o cierre de llamada sobre ${THRESHOLDS.wrapUpSeconds} segundos.`
            : `Se sincroniza cada ${POLL_MS / 1000} segundos.`
        }
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Estado" className="w-44">
              <Select value={group} onChange={(event) => setGroup(event.target.value as AgentGroup | "")}>
                <option value="">Todos</option>
                {(Object.keys(GROUP_LABEL) as AgentGroup[]).map((key) => (
                  <option key={key} value={key}>
                    {GROUP_LABEL[key]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Campaña" className="w-48">
              <Select value={campaign} onChange={(event) => setCampaign(event.target.value)}>
                <option value="">Todas</option>
                {campaignOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Buscar" className="w-56">
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Nombre o extensión"
              />
            </Field>
          </div>

          <DataTable
            rows={filteredAgents}
            columns={columns}
            getRowId={(row) => row.profile_id}
            storageKey="monitor-agentes"
            exportFilename="monitor-en-vivo"
            emptyTitle="Ningún ejecutivo con estos filtros"
            emptyDescription="Quita el filtro de estado o campaña para ver a todo el equipo."
          />
        </div>
      </SectionCard>
    </div>
  );
}
