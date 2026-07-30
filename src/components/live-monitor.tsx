"use client";

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Bar, BarChart, Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Eye, EyeOff, GripVertical, LayoutDashboard, Radio, RotateCcw, Sparkles } from "lucide-react";
import { getAgentLiveStatus, getQueueHealth } from "@/app/actions/supervision";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";
import { LEGAL_INTERCALL_BREAK_SECONDS } from "@/lib/intercall-break";
import { usePersistentState } from "@/lib/persistent-state";
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
type WidgetSize = "small" | "medium" | "wide" | "full";
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

type WidgetConfig = { id: WidgetId; size: WidgetSize; visible: boolean };

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

const WIDGET_LABEL: Record<WidgetId, string> = {
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
  "status-chart": "Distribución del equipo",
  "campaign-chart": "Actividad por campaña",
  queues: "Salud de las colas",
  agents: "Ejecutivos",
};

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: "occupancy", size: "small", visible: true },
  { id: "connected", size: "small", visible: true },
  { id: "available", size: "small", visible: true },
  { id: "on-call", size: "small", visible: true },
  { id: "wrap-up", size: "small", visible: true },
  { id: "paused", size: "small", visible: true },
  { id: "alerts", size: "small", visible: true },
  { id: "campaigns", size: "small", visible: true },
  { id: "answered", size: "medium", visible: true },
  { id: "completed", size: "medium", visible: true },
  { id: "abandon-rate", size: "medium", visible: true },
  { id: "no-answer-rate", size: "medium", visible: true },
  { id: "status-chart", size: "wide", visible: true },
  { id: "campaign-chart", size: "wide", visible: true },
  { id: "queues", size: "full", visible: true },
  { id: "agents", size: "full", visible: true },
];

const SIZE_CLASS: Record<WidgetSize, string> = {
  small: "md:col-span-3",
  medium: "md:col-span-4",
  wide: "md:col-span-6",
  full: "md:col-span-12",
};

const SIZE_LABEL: Record<WidgetSize, string> = {
  small: "Compacta",
  medium: "Mediana",
  wide: "Ancha",
  full: "Completa",
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
  if (agent.is_pause) return "paused";
  if (agent.phone_status === "wrap_up") return "wrap_up";
  if (agent.phone_status === "available") return "available";
  return "offline";
}

function agentDisplay(agent: AgentLiveStatus, now: number): { label: string; tone: BadgeTone; since: string | null; alert: boolean } {
  if (agent.phone_status === "on_call") return { label: "En llamada", tone: "info", since: agent.phone_status_since, alert: false };
  if (agent.phone_status === "ringing") return { label: "Timbrando", tone: "warning", since: agent.phone_status_since, alert: false };
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

function DashboardWidget({ config, editing, onSizeChange, onToggleVisible, onDragStart, onDrop, children }: { config: WidgetConfig; editing: boolean; onSizeChange: (size: WidgetSize) => void; onToggleVisible: () => void; onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDrop: (event: DragEvent<HTMLDivElement>) => void; children: ReactNode }) {
  return (
    <div className={cn("group/widget min-w-0", SIZE_CLASS[config.size])} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <Card className={cn("relative h-full overflow-hidden rounded-2xl border-border/90 p-5 shadow-[0_14px_35px_-26px_rgba(24,49,55,0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-26px_rgba(24,49,55,0.55)]", editing && "ring-2 ring-primary/25")}>
        {!editing && <div className="absolute left-0 top-5 h-8 w-0.5 rounded-r-full bg-primary opacity-0 transition-opacity group-hover/widget:opacity-100" />}
        {editing && (
          <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
            <span className="min-w-0 truncate text-[10px] font-semibold tracking-[0.14em] text-primary">{WIDGET_KICKER[config.id]} · {WIDGET_LABEL[config.id]}</span>
            <div className="flex items-center gap-1">
              <select aria-label={`Tamaño de ${WIDGET_LABEL[config.id]}`} value={config.size} onChange={(event) => onSizeChange(event.target.value as WidgetSize)} className="h-7 rounded border border-border bg-surface px-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((size) => <option key={size} value={size}>{SIZE_LABEL[size]}</option>)}
              </select>
              <button type="button" draggable onDragStart={onDragStart} aria-label={`Arrastrar ${WIDGET_LABEL[config.id]}`} title="Arrastra para reordenar" className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground active:cursor-grabbing">
                <GripVertical size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={onToggleVisible} aria-label={`Ocultar ${WIDGET_LABEL[config.id]}`} title="Ocultar" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground">
                <EyeOff size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {children}
      </Card>
    </div>
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
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState<WidgetId | null>(null);
  const [layout, setLayout] = usePersistentState<WidgetConfig[]>("atlas:live-monitor-layout:v1", DEFAULT_LAYOUT);

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
  const columns = useMemo<Column<AgentLiveStatus>[]>(() => [
    { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
    { id: "extension", header: "Extensión", value: (row) => row.extension, className: "text-muted-foreground" },
    { id: "campana", header: "Campaña", value: (row) => row.campaign_name ?? "", cell: (row) => row.campaign_name ?? "—", className: "text-muted-foreground" },
    { id: "estado", header: "Estado", value: (row) => agentDisplay(row, now).label, cell: (row) => { const { label, tone } = agentDisplay(row, now); return <span className="inline-flex items-center gap-2"><StatusDot tone={tone} />{label}</span>; } },
    { id: "tiempo", header: "Tiempo en estado", align: "right", value: (row) => elapsedSeconds(agentDisplay(row, now).since, now) ?? -1, cell: (row) => { const { since, alert } = agentDisplay(row, now); return <span className={alert ? "font-medium text-danger" : "tabular-nums"}>{formatElapsed(elapsedSeconds(since, now))}{alert && " ⚠"}</span>; } },
  ], [now]);

  function updateWidget(id: WidgetId, patch: Partial<WidgetConfig>) { setLayout((current) => current.map((widget) => widget.id === id ? { ...widget, ...patch } : widget)); }
  function reorder(targetId: WidgetId) { if (!draggedId || draggedId === targetId) return; setLayout((current) => { const next = [...current]; const from = next.findIndex((widget) => widget.id === draggedId); const to = next.findIndex((widget) => widget.id === targetId); const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; }); setDraggedId(null); }

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
  const visibleWidgets = layout.filter((widget) => widget.visible);
  const hiddenWidgets = layout.filter((widget) => !widget.visible);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-[#262523] px-5 py-5 text-[#f2f2f2] shadow-[0_20px_45px_-28px_rgba(24,49,55,0.9)] sm:px-6 sm:py-6">
        <div className="absolute -right-10 -top-14 size-48 rounded-full border border-[#f2f2f2]/10" />
        <div className="absolute right-10 top-7 size-20 rounded-full border border-[#f2f2f2]/10" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#f2f2f2]/15 bg-[#f2f2f2]/5 px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] text-accent">
              <Radio size={12} aria-hidden="true" /> SEÑAL EN VIVO
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.045em] text-[#f2f2f2] sm:text-3xl">Centro de control operacional</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#f2f2f2]/65">Una lectura clara de la capacidad, carga y riesgo del equipo. Se actualiza cada {POLL_MS / 1000} segundos.</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[#f2f2f2]/10 rounded-xl border border-[#f2f2f2]/10 bg-[#f2f2f2]/5">
            <div className="px-4 py-3"><p className="text-[9px] font-semibold tracking-[0.14em] text-[#f2f2f2]/50">CONECTADOS</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#f2f2f2]">{connected}</p></div>
            <div className="px-4 py-3"><p className="text-[9px] font-semibold tracking-[0.14em] text-[#f2f2f2]/50">EN CURSO</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#f2f2f2]">{totals.inFlight}</p></div>
            <div className="px-4 py-3"><p className="text-[9px] font-semibold tracking-[0.14em] text-[#f2f2f2]/50">ALERTAS</p><p className={cn("mt-1 font-mono text-xl font-semibold tabular-nums", alerts ? "text-danger" : "text-accent")}>{alerts}</p></div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-[0_12px_30px_-25px_rgba(24,49,55,0.6)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-surface-muted text-primary"><LayoutDashboard size={18} aria-hidden="true" /></span>
          <div><p className="text-sm font-semibold text-foreground">Tu mesa de supervisión</p><p className="text-xs text-muted-foreground">Compón el tablero según lo que necesites vigilar.</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setLayout(DEFAULT_LAYOUT)} title="Restaurar orden y tamaños iniciales"><RotateCcw size={14} aria-hidden="true" />Restaurar</Button>
          <Button variant={editing ? "primary" : "secondary"} size="sm" onClick={() => setEditing((value) => !value)}>{editing ? "Guardar vista" : "Personalizar"}<ChevronRight size={14} aria-hidden="true" /></Button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3.5">
          <span className="inline-flex items-center gap-2 pr-2 text-xs font-medium text-foreground"><Sparkles size={14} className="text-primary" aria-hidden="true" />Modo composición: usa el control lateral para arrastrar y ajusta el tamaño aquí mismo.</span>
          {hiddenWidgets.map((widget) => <button key={widget.id} type="button" onClick={() => updateWidget(widget.id, { visible: true })} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-surface-muted"><Eye size={13} aria-hidden="true" />Mostrar {WIDGET_LABEL[widget.id]}</button>)}
          {hiddenWidgets.length === 0 && <span className="text-xs text-muted-foreground">Todos los módulos están visibles.</span>}
        </div>
      )}
      {visibleWidgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">No hay paneles visibles. Activa uno desde el modo Personalizar.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {visibleWidgets.map((widget) => <DashboardWidget key={widget.id} config={widget} editing={editing} onSizeChange={(size) => updateWidget(widget.id, { size })} onToggleVisible={() => updateWidget(widget.id, { visible: false })} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedId(widget.id); }} onDrop={() => reorder(widget.id)}>{widgets[widget.id]}</DashboardWidget>)}
        </div>
      )}
    </div>
  );
}
