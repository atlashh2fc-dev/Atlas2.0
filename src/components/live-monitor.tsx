"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Bar, BarChart, Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import { LogOut, Plus, RotateCcw, X } from "lucide-react";
import { forceAgentLogout, getAgentLiveStatus, getQueueHealth } from "@/app/actions/supervision";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";
import { LEGAL_INTERCALL_BREAK_SECONDS } from "@/lib/intercall-break";
import { useViewPreference } from "@/lib/use-view-preference";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  DataTable,
  Field,
  Input,
  LoadingState,
  MetricLabel,
  SectionCard,
  Select,
  StatusDot,
  useToast,
  type BadgeTone,
  type Column,
} from "@/components/ui";

const POLL_MS = 2000;

/** Umbrales operativos: sobre estos valores el estado se marca en rojo. */
const THRESHOLDS = {
  pauseSeconds: 15 * 60,
  wrapUpSeconds: 120,
  abandonRate: 6,
};

type AgentGroup = "available" | "on_call" | "wrap_up" | "paused" | "offline";
type WidgetId =
  | "occupancy"
  | "connected"
  | "available"
  | "on-call"
  | "wrap-up"
  | "paused"
  | "alerts"
  | "campaigns"
  | "answered"
  | "completed"
  | "abandon-rate"
  | "no-answer-rate"
  | "status-chart"
  | "campaign-chart"
  | "queues"
  | "agents";

type WidgetLayout = LayoutItem & { i: WidgetId };

const GROUP_LABEL: Record<AgentGroup, string> = {
  available: "Disponibles",
  on_call: "En llamada",
  wrap_up: "En cierre",
  paused: "En pausa",
  offline: "Sin conexión",
};

const STATUS_COLORS: Record<AgentGroup, string> = {
  available: "var(--success)",
  on_call: "var(--primary)",
  wrap_up: "var(--warning)",
  paused: "var(--danger)",
  offline: "var(--muted-foreground)",
};

const DEFAULT_LAYOUT: WidgetLayout[] = [
  { i: "occupancy", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "connected", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "available", x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "on-call", x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "wrap-up", x: 0, y: 3, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "paused", x: 3, y: 3, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "alerts", x: 6, y: 3, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "campaigns", x: 9, y: 3, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "answered", x: 0, y: 6, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "completed", x: 3, y: 6, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "abandon-rate", x: 6, y: 6, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "no-answer-rate", x: 9, y: 6, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "status-chart", x: 0, y: 9, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "campaign-chart", x: 6, y: 9, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "queues", x: 0, y: 15, w: 12, h: 6, minW: 6, minH: 3 },
  { i: "agents", x: 0, y: 21, w: 12, h: 10, minW: 6, minH: 6 },
];

/** Orden canónico para el panel de tarjetas ocultas. */
const WIDGET_ORDER: WidgetId[] = DEFAULT_LAYOUT.map((item) => item.i);

type MonitorPreference = {
  layout: WidgetLayout[];
  /** Tarjetas que el supervisor sacó de su vista. */
  hidden: WidgetId[];
};

const DEFAULT_PREFERENCE: MonitorPreference = { layout: DEFAULT_LAYOUT, hidden: [] };

/** Nombre de cada tarjeta para los controles de quitar y reponer. */
const WIDGET_TITLE: Record<WidgetId, string> = {
  occupancy: "Ocupación del equipo",
  connected: "Equipo conectado",
  available: "Disponibles",
  "on-call": "En llamada",
  "wrap-up": "En cierre",
  paused: "En pausa",
  alerts: "Alertas operativas",
  campaigns: "Campañas activas",
  answered: "Contestadas hoy",
  completed: "Completadas hoy",
  "abandon-rate": "Abandono hoy",
  "no-answer-rate": "Sin respuesta hoy",
  "status-chart": "Estados del equipo",
  "campaign-chart": "Actividad por campaña",
  queues: "Salud de campañas",
  agents: "Detalle de ejecutivos",
};

const WIDGET_KICKER: Record<WidgetId, string> = {
  occupancy: "CAPACIDAD",
  connected: "PRESENCIA",
  available: "PREPARADOS",
  "on-call": "CONVERSACIÓN",
  "wrap-up": "POST-LLAMADA",
  paused: "AUXILIAR",
  alerts: "ATENCIÓN",
  campaigns: "OPERACIÓN",
  answered: "VOLUMEN",
  completed: "RESULTADO",
  "abandon-rate": "GUARDARRAÍL",
  "no-answer-rate": "CONTACTO",
  "status-chart": "LECTURA DEL EQUIPO",
  "campaign-chart": "PULSO DE CAMPAÑAS",
  queues: "SALUD OPERACIONAL",
  agents: "SEGUIMIENTO EN VIVO",
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
  if (agent.reason_code === "desconectado" || agent.phone_status === "offline") return "offline";
  if (agent.is_pause) return "paused";
  if (agent.phone_status === "wrap_up") return "wrap_up";
  if (agent.phone_status === "available") return "available";
  return "offline";
}

function agentDisplay(agent: AgentLiveStatus, now: number): { label: string; tone: BadgeTone; since: string | null; alert: boolean } {
  if (agent.phone_status === "on_call") return { label: "En llamada", tone: "info", since: agent.phone_status_since, alert: false };
  if (agent.phone_status === "ringing") return { label: "Timbrando", tone: "warning", since: agent.phone_status_since, alert: false };
  // Desconectado es ausencia, no una pausa/AUX. Fuera del horario no acumula
  // nada; dentro del horario se calcula como métrica separada en reportes.
  if (agent.reason_code === "desconectado") {
    return { label: "Desconectado", tone: "neutral", since: null, alert: false };
  }
  if (agent.is_pause && agent.reason_label) {
    const seconds = elapsedSeconds(agent.reason_since, now);
    return { label: agent.reason_label, tone: "danger", since: agent.reason_since, alert: seconds != null && seconds > THRESHOLDS.pauseSeconds };
  }
  if (agent.phone_status === "wrap_up") {
    const seconds = elapsedSeconds(agent.phone_status_since, now) ?? LEGAL_INTERCALL_BREAK_SECONDS;
    const inLegalBreak = seconds < LEGAL_INTERCALL_BREAK_SECONDS;
    return {
      label: inLegalBreak ? `Interrupción legal · ${LEGAL_INTERCALL_BREAK_SECONDS - seconds}s` : "Cierre de llamada pendiente",
      tone: "warning",
      since: agent.phone_status_since,
      alert: !inLegalBreak && seconds > THRESHOLDS.wrapUpSeconds,
    };
  }
  if (agent.phone_status === "available") return { label: "Disponible", tone: "success", since: agent.reason_since ?? agent.phone_status_since, alert: false };
  return { label: "Sin conexión", tone: "neutral", since: null, alert: false };
}

function formatInt(value: number): string {
  return value.toLocaleString("es-CL");
}

function MetricWidget({ label, value, hint, tone = "default", metric, children, kicker }: { label: string; value: string | number; hint?: ReactNode; tone?: "default" | "warn" | "danger" | "good"; metric?: "ocupacion" | "abandono"; children?: ReactNode; kicker: string }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "text-foreground";
  return (
    <div className="relative flex h-full min-h-32 flex-col justify-between overflow-hidden">
      <div className="absolute right-0 top-0 size-14 rounded-full border border-border/70" />
      <div className="absolute right-3 top-3 size-8 rounded-full border border-border/60" />
      <div>
        <p className="mb-3 text-[9px] font-semibold tracking-[0.2em] text-primary">{kicker}</p>
        <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {metric ? <MetricLabel id={metric} /> : label}
        </p>
        <p className={cn("mt-1.5 text-4xl font-semibold tabular-nums tracking-[-0.06em]", color)}>{value}</p>
      </div>
      {(hint || children) && <div className="mt-4 border-t border-border/70 pt-2.5 text-xs leading-relaxed text-muted-foreground">{hint}{children}</div>}
    </div>
  );
}

function QueueHealthCard({ queue }: { queue: QueueHealth }) {
  const handled = queue.answered_today + queue.abandoned_today;
  const abandonRate = handled > 0 ? Math.round((queue.abandoned_today / handled) * 100) : 0;
  const overThreshold = abandonRate > THRESHOLDS.abandonRate;
  return (
    <div className="rounded-xl border border-border bg-surface-muted/40 p-4 transition-colors hover:bg-surface-muted/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <p className="text-sm font-semibold text-foreground">{queue.campaign_name}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cola · {queue.queue_name}</p>
        </div>
        <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", overThreshold ? "border-danger/30 bg-danger-bg text-danger" : "border-border bg-surface text-muted-foreground")}>Abandono {abandonRate}%</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QueueNumber label="En curso" value={queue.in_flight} />
        <QueueNumber label="Contestadas" value={queue.answered_today} />
        <QueueNumber label="Completadas" value={queue.completed_today} />
        <QueueNumber label="No responde" value={queue.no_answer_today} />
      </div>
    </div>
  );
}

function QueueNumber({ label, value }: { label: string; value: number }) {
  return <div><p className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{formatInt(value)}</p><p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p></div>;
}

export function LiveMonitor({ canForceLogout = false }: { canForceLogout?: boolean }) {
  const [agents, setAgents] = useState<AgentLiveStatus[]>([]);
  const [queues, setQueues] = useState<QueueHealth[]>([]);
  const [now, setNow] = useState(() => new Date().getTime());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<AgentGroup | "">("");
  const [campaign, setCampaign] = useState("");
  const [term, setTerm] = useState("");
  const [logoutTarget, setLogoutTarget] = useState<AgentLiveStatus | null>(null);
  const [logoutReason, setLogoutReason] = useState("");
  const [logoutPending, startLogoutTransition] = useTransition();
  const logoutDialogRef = useRef<HTMLDialogElement>(null);
  const { toast } = useToast();
  // La vista es de la persona, no del navegador: se guarda en la cuenta para
  // que cada supervisor arme su monitor y lo encuentre igual desde donde entre.
  const [preference, setPreference] = useViewPreference<MonitorPreference>(
    "live-monitor",
    DEFAULT_PREFERENCE
  );
  // Estabiliza la referencia: una preferencia guardada antes de esta versión no
  // trae `hidden`, y el `?? []` crearía un arreglo nuevo en cada render.
  const hidden = useMemo(() => preference.hidden ?? [], [preference.hidden]);
  const hiddenSet = useMemo(() => new Set<WidgetId>(hidden), [hidden]);
  const hiddenWidgets = useMemo(
    () => WIDGET_ORDER.filter((id) => hiddenSet.has(id)),
    [hiddenSet]
  );
  const { width, containerRef } = useContainerWidth();

  const setLayout = useCallback(
    (nextLayout: WidgetLayout[]) => {
      setPreference({ layout: nextLayout, hidden });
    },
    [setPreference, hidden]
  );

  const hideWidget = useCallback(
    (id: WidgetId) => {
      setPreference({
        layout: preference.layout.filter((item) => item.i !== id),
        hidden: [...hidden.filter((value) => value !== id), id],
      });
    },
    [setPreference, preference.layout, hidden]
  );

  const showWidget = useCallback(
    (id: WidgetId) => {
      const fallback = DEFAULT_LAYOUT.find((item) => item.i === id);
      // Vuelve al final de la grilla: reinsertarla en su hueco original
      // desordenaría lo que el supervisor ya acomodó.
      const maxY = preference.layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
      setPreference({
        layout: [
          ...preference.layout,
          { ...(fallback ?? { i: id, x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 }), x: 0, y: maxY },
        ],
        hidden: hidden.filter((value) => value !== id),
      });
    },
    [setPreference, preference.layout, hidden]
  );

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
    return () => { disposed = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const groups = useMemo(() => {
    const counters: Record<AgentGroup, number> = { available: 0, on_call: 0, wrap_up: 0, paused: 0, offline: 0 };
    for (const agent of agents) counters[groupOf(agent)] += 1;
    return counters;
  }, [agents]);
  const connected = agents.length - groups.offline;
  const occupancy = connected > 0 ? Math.round(((groups.on_call + groups.wrap_up) / connected) * 100) : 0;
  const alerts = agents.filter((agent) => agentDisplay(agent, now).alert).length;
  const totals = useMemo(() => queues.reduce((all, queue) => ({ inFlight: all.inFlight + queue.in_flight, answered: all.answered + queue.answered_today, completed: all.completed + queue.completed_today, abandoned: all.abandoned + queue.abandoned_today, noAnswer: all.noAnswer + queue.no_answer_today }), { inFlight: 0, answered: 0, completed: 0, abandoned: 0, noAnswer: 0 }), [queues]);
  const abandonRate = totals.answered + totals.abandoned > 0 ? Math.round((totals.abandoned / (totals.answered + totals.abandoned)) * 100) : 0;
  const noAnswerRate = totals.answered + totals.noAnswer > 0 ? Math.round((totals.noAnswer / (totals.answered + totals.noAnswer)) * 100) : 0;
  const campaignOptions = useMemo(() => [...new Set(agents.map((agent) => agent.campaign_name).filter((name): name is string => Boolean(name)))].sort(), [agents]);
  const normalizedTerm = term.trim().toLocaleLowerCase("es-CL");
  const filteredAgents = useMemo(() => agents.filter((agent) => {
    if (group && groupOf(agent) !== group) return false;
    if (campaign && agent.campaign_name !== campaign) return false;
    return !normalizedTerm || `${agent.full_name} ${agent.extension}`.toLocaleLowerCase("es-CL").includes(normalizedTerm);
  }), [agents, group, campaign, normalizedTerm]);
  const statusChartData = (Object.keys(GROUP_LABEL) as AgentGroup[]).map((key) => ({ name: GROUP_LABEL[key], value: groups[key], color: STATUS_COLORS[key] }));
  const campaignChartData = queues.map((queue) => ({ name: queue.campaign_name.length > 18 ? `${queue.campaign_name.slice(0, 16)}…` : queue.campaign_name, fullName: queue.campaign_name, "En curso": queue.in_flight, Contestadas: queue.answered_today, Completadas: queue.completed_today }));
  const openLogoutDialog = useCallback((agent: AgentLiveStatus) => {
    setLogoutTarget(agent);
    setLogoutReason("");
    queueMicrotask(() => logoutDialogRef.current?.showModal());
  }, []);

  function confirmLogout() {
    if (!logoutTarget) return;
    startLogoutTransition(async () => {
      try {
        await forceAgentLogout(logoutTarget.profile_id, logoutReason);
        toast({
          tone: "success",
          message: `Cierre solicitado para ${logoutTarget.full_name}. Atlas confirmará navegador y PBX por separado.`,
        });
        logoutDialogRef.current?.close();
        setLogoutTarget(null);
      } catch (err) {
        toast({
          tone: "danger",
          message: err instanceof Error ? err.message : "No se pudo cerrar la sesión.",
        });
      }
    });
  }

  const columns = useMemo<Column<AgentLiveStatus>[]>(() => [
    { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
    { id: "extension", header: "Extensión", value: (row) => row.extension, className: "text-muted-foreground" },
    { id: "campana", header: "Campaña", value: (row) => row.campaign_name ?? "", cell: (row) => row.campaign_name ?? "—", className: "text-muted-foreground" },
    { id: "estado", header: "Estado", value: (row) => agentDisplay(row, now).label, cell: (row) => { const { label, tone } = agentDisplay(row, now); return <span className="inline-flex items-center gap-2"><StatusDot tone={tone} />{label}</span>; } },
    { id: "tiempo", header: "Tiempo en estado", align: "right", value: (row) => elapsedSeconds(agentDisplay(row, now).since, now) ?? -1, cell: (row) => { const { since, alert } = agentDisplay(row, now); return <span className={alert ? "font-medium text-danger" : "tabular-nums"}>{formatElapsed(elapsedSeconds(since, now))}{alert && " ⚠"}</span>; } },
    ...(canForceLogout ? [{
      id: "acciones",
      header: "",
      align: "right" as const,
      sortable: false,
      cell: (row: AgentLiveStatus) => {
        const controlRelevant = Boolean(
          row.reason_code === "desconectado" &&
          row.control_requested_at &&
          (!row.reason_since || new Date(row.control_requested_at).getTime() >= new Date(row.reason_since).getTime())
        );
        const closing = controlRelevant && (row.control_status === "pending" || row.control_status === "processing");
        const failed = controlRelevant && row.control_status === "failed";
        return (
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              size="sm"
              variant={failed ? "danger" : "secondary"}
              disabled={closing}
              onClick={() => openLogoutDialog(row)}
            >
              <LogOut size={13} aria-hidden="true" />
              {closing ? "Cerrando…" : failed ? "Reintentar" : "Cerrar sesión"}
            </Button>
            {controlRelevant && row.control_status === "completed" && (
              <span className="text-[10px] text-success">
                {row.control_browser_acknowledged_at ? "Navegador y PBX confirmados" : "PBX confirmado"}
              </span>
            )}
          </div>
        );
      },
    }] : []),
  ], [now, canForceLogout, openLogoutDialog]);

  const widgets: Record<WidgetId, ReactNode> = {
    occupancy: <MetricWidget kicker={WIDGET_KICKER.occupancy} label="Ocupación del equipo" metric="ocupacion" value={`${occupancy}%`} hint={`${connected} conectados · objetivo operativo 85%`} tone={occupancy >= 85 ? "warn" : "default"} />,
    connected: <MetricWidget kicker={WIDGET_KICKER.connected} label="Equipo conectado" value={connected} hint={`de ${agents.length} ejecutivos`} />,
    available: <MetricWidget kicker={WIDGET_KICKER.available} label="Disponibles" value={groups.available} hint={connected ? `${Math.round((groups.available / connected) * 100)}% del equipo conectado` : "Sin equipo conectado"} tone={groups.available === 0 && connected > 0 ? "warn" : "good"} />,
    "on-call": <MetricWidget kicker={WIDGET_KICKER["on-call"]} label="En llamada" value={groups.on_call} hint={`${groups.on_call + groups.wrap_up} trabajando llamadas`} />,
    "wrap-up": <MetricWidget kicker={WIDGET_KICKER["wrap-up"]} label="En cierre" value={groups.wrap_up} hint="Incluye interrupción legal y ACW" tone={groups.wrap_up > 0 ? "warn" : "default"} />,
    paused: <MetricWidget kicker={WIDGET_KICKER.paused} label="En pausa" value={groups.paused} hint="Fuera de la cola por AUX" tone={groups.paused > 0 ? "warn" : "default"} />,
    alerts: <MetricWidget kicker={WIDGET_KICKER.alerts} label="Alertas operativas" value={alerts} hint={alerts ? "Pausa o cierre fuera de umbral" : "Todo dentro de los umbrales"} tone={alerts ? "danger" : "good"} />,
    campaigns: <MetricWidget kicker={WIDGET_KICKER.campaigns} label="Campañas activas" value={queues.length} hint={`${totals.inFlight} llamadas en curso`} />,
    answered: <MetricWidget kicker={WIDGET_KICKER.answered} label="Contestadas hoy" value={formatInt(totals.answered)} hint={`${formatInt(totals.inFlight)} en curso ahora`} />,
    completed: <MetricWidget kicker={WIDGET_KICKER.completed} label="Completadas hoy" value={formatInt(totals.completed)} hint={totals.answered ? `${Math.round((totals.completed / totals.answered) * 100)}% de las contestadas` : "Sin llamadas contestadas"} />,
    "abandon-rate": <MetricWidget kicker={WIDGET_KICKER["abandon-rate"]} label="Abandono hoy" metric="abandono" value={`${abandonRate}%`} hint={`${formatInt(totals.abandoned)} abandonadas · umbral ${THRESHOLDS.abandonRate}%`} tone={abandonRate > THRESHOLDS.abandonRate ? "danger" : "good"} />,
    "no-answer-rate": <MetricWidget kicker={WIDGET_KICKER["no-answer-rate"]} label="Sin respuesta hoy" value={`${noAnswerRate}%`} hint={`${formatInt(totals.noAnswer)} intentos sin respuesta`} tone={noAnswerRate >= 70 ? "warn" : "default"} />,
    "status-chart": (
      <div className="h-[19.5rem]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-primary">{WIDGET_KICKER["status-chart"]}</p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">Distribución del equipo</p>
            <p className="mt-1 text-xs text-muted-foreground">Lectura de disponibilidad en este instante.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-muted/60 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Conectados</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-foreground">{connected}<span className="text-sm text-muted-foreground">/{agents.length}</span></p>
          </div>
        </div>
        <div className="mt-2 grid h-52 grid-cols-[1fr_10.5rem] items-center gap-2 sm:grid-cols-[1fr_13rem]">
          <div className="space-y-1.5">
            {statusChartData.map((item) => (
              <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-surface-muted" key={item.name}>
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><i className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{item.value}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={4} stroke="var(--surface)" strokeWidth={4}>
                {statusChartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                <Label value={`${occupancy}%`} position="center" className="fill-foreground text-2xl font-semibold" />
              </Pie>
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, boxShadow: "0 14px 28px -18px rgba(24,49,55,.55)" }} formatter={(value) => [formatInt(Number(value)), "Ejecutivos"]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    ),
    "campaign-chart": (
      <div className="h-[19.5rem]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-primary">{WIDGET_KICKER["campaign-chart"]}</p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">Actividad por campaña</p>
            <p className="mt-1 text-xs text-muted-foreground">Acumulado de jornada y carga que sigue activa.</p>
          </div>
          <div className="flex flex-col gap-1 text-right text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm bg-accent" />En curso</span>
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm bg-primary" />Contestadas</span>
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm bg-success" />Completadas</span>
          </div>
        </div>
        {campaignChartData.length ? (
          <ResponsiveContainer width="100%" height="76%">
            <BarChart data={campaignChartData} margin={{ top: 16, left: -12, right: 8, bottom: 0 }} barCategoryGap="28%">
              <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--surface-muted)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, boxShadow: "0 14px 28px -18px rgba(24,49,55,.55)" }} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""} />
              <Bar dataKey="En curso" stackId="a" fill="var(--accent)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="Contestadas" stackId="a" fill="var(--primary)" />
              <Bar dataKey="Completadas" stackId="a" fill="var(--success)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No hay campañas activas.</div>}
      </div>
    ),
    queues: (
      <SectionCard className="rounded-xl border-border" title={<span className="text-base tracking-tight">Salud de las colas</span>} description={`Actualizado automáticamente cada ${POLL_MS / 1000} segundos.`} actions={<span className="hidden items-center gap-1 text-[10px] font-semibold tracking-[0.14em] text-success sm:inline-flex"><span className="size-1.5 rounded-full bg-success" />LIVE</span>}>
        <div className="space-y-3 p-4">{queues.length === 0 ? <p className="text-sm text-muted-foreground">No hay campañas activas para el motor de discado.</p> : queues.map((queue) => <QueueHealthCard key={queue.campaign_id} queue={queue} />)}</div>
      </SectionCard>
    ),
    agents: (
      <SectionCard className="rounded-xl border-border" title={<span className="text-base tracking-tight">Ejecutivos <span className="font-mono text-sm font-medium text-muted-foreground">({filteredAgents.length})</span></span>} description={alerts > 0 ? `${alerts} sobre el umbral: pausa mayor a ${THRESHOLDS.pauseSeconds / 60} minutos o cierre de llamada sobre ${THRESHOLDS.wrapUpSeconds} segundos.` : `Se sincroniza cada ${POLL_MS / 1000} segundos.`}>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-surface-muted/45 p-3">
            <Field label="Estado" className="w-44"><Select value={group} onChange={(event) => setGroup(event.target.value as AgentGroup | "")}><option value="">Todos</option>{(Object.keys(GROUP_LABEL) as AgentGroup[]).map((key) => <option key={key} value={key}>{GROUP_LABEL[key]}</option>)}</Select></Field>
            <Field label="Campaña" className="w-48"><Select value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="">Todas</option>{campaignOptions.map((name) => <option key={name} value={name}>{name}</option>)}</Select></Field>
            <Field label="Buscar" className="w-56"><Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Nombre o extensión" /></Field>
          </div>
          <DataTable rows={filteredAgents} columns={columns} getRowId={(row) => row.profile_id} storageKey="monitor-agentes" exportFilename="monitor-en-vivo" emptyTitle="Ningún ejecutivo con estos filtros" emptyDescription="Quita el filtro de estado o campaña para ver a todo el equipo." />
        </div>
      </SectionCard>
    ),
  };

  if (loading) return <LoadingState label="Estamos conectando el monitor en vivo" className="rounded-xl border border-border bg-surface px-5 py-4" />;
  if (error) return <p className="text-sm text-danger">Error: {error}</p>;
  // Se reconstruye desde el catálogo, no desde lo guardado: así una tarjeta
  // nueva del producto aparece sola y una preferencia vieja o corrupta no deja
  // el monitor en blanco. Lo oculto se respeta; lo que falte se repone.
  const safeLayout: WidgetLayout[] = WIDGET_ORDER.filter((id) => !hiddenSet.has(id)).map((id) => {
    const saved = preference.layout?.find((item) => item.i === id);
    return saved ?? DEFAULT_LAYOUT.find((item) => item.i === id)!;
  });

  return (
    <div className="space-y-4">
      <dialog
        ref={logoutDialogRef}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/45"
        onClose={() => setLogoutTarget(null)}
      >
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-danger">Cierre administrativo</p>
          <h2 className="mt-1 text-lg font-semibold">Cerrar sesión de {logoutTarget?.full_name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Se cortará una llamada activa, el teléfono WebRTC y las sesiones actuales. La cuenta, extensión,
            campañas y cartera seguirán activas para que pueda volver a iniciar sesión normalmente.
          </p>
        </div>
        <div className="p-5">
          <Field label="Motivo (opcional)">
            <Input
              value={logoutReason}
              maxLength={240}
              onChange={(event) => setLogoutReason(event.target.value)}
              placeholder="Ej. cierre solicitado por supervisión"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="secondary" disabled={logoutPending} onClick={() => logoutDialogRef.current?.close()}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" disabled={logoutPending} onClick={confirmLogout}>
            {logoutPending ? "Cerrando…" : "Cerrar sesión ahora"}
          </Button>
        </div>
      </dialog>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hiddenWidgets.length > 0 && (
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {hiddenWidgets.length === 1 ? "Tarjeta oculta:" : "Tarjetas ocultas:"}
            </span>
            {hiddenWidgets.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => showWidget(id)}
                title="Volver a mostrar esta tarjeta"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
              >
                <Plus size={12} aria-hidden="true" />
                {WIDGET_TITLE[id]}
              </button>
            ))}
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPreference(DEFAULT_PREFERENCE)}
          title="Restaurar orden, tamaños y tarjetas iniciales"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Restaurar vista
        </Button>
      </div>
      <div ref={containerRef}>
        <ReactGridLayout
          className="atlas-live-grid"
          layout={safeLayout}
          width={width}
          gridConfig={{ cols: 12, rowHeight: 48, margin: [16, 16], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, cancel: "input,textarea,button,select,a,[data-no-drag]" }}
          resizeConfig={{ enabled: true, handles: ["se"] }}
          compactor={verticalCompactor}
          onLayoutChange={(nextLayout: Layout) => setLayout(nextLayout as WidgetLayout[])}
        >
          {safeLayout.map((item) => (
            <div key={item.i}>
              <Card className="group relative h-full overflow-hidden rounded-xl border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md">
                {/* `data-no-drag` evita que quitar la tarjeta se interprete
                    como el inicio de un arrastre. */}
                <button
                  type="button"
                  data-no-drag
                  onClick={() => hideWidget(item.i)}
                  title={`Quitar ${WIDGET_TITLE[item.i]} de mi vista`}
                  aria-label={`Quitar ${WIDGET_TITLE[item.i]} de mi vista`}
                  className="absolute right-2 top-2 z-10 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-surface-muted hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X size={14} aria-hidden="true" />
                </button>
                {widgets[item.i]}
              </Card>
            </div>
          ))}
        </ReactGridLayout>
      </div>
    </div>
  );
}
