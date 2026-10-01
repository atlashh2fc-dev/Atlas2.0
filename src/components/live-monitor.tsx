"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import {
  Activity,
  BadgeCheck,
  ChartPie,
  CircleCheck,
  ClipboardList,
  ClipboardPen,
  Clock,
  Coffee,
  Funnel,
  Gauge,
  Layers,
  LogOut,
  Megaphone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Plus,
  Repeat,
  RotateCcw,
  ServerCrash,
  Target,
  Timer,
  TriangleAlert,
  Trophy,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { forceAgentLogout, getAgentLiveStatus, getLiveWallboard, getQueueHealth, getStatusReasonCaps, type ConectadosSinAlo, type EmbudoCopc, type LiveWallboard } from "@/app/actions/supervision";
import type { AgentLiveStatus, QueueHealth } from "@/lib/types";
import { LEGAL_INTERCALL_BREAK_SECONDS } from "@/lib/intercall-break";
import { avisoParaSupervisor, estadoDeTope } from "@/lib/tope-de-pausa";
import { useViewPreference } from "@/lib/use-view-preference";
import type { MetricId } from "@/lib/metric-definitions";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { cn } from "@/lib/utils";
import {
  CHART_AXIS_TICK,
  CHART_COLOR,
  CHART_CURSOR,
  CHART_GRID,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  chartGradients,
  gradientUrl,
  useChartId,
} from "@/components/chart-theme";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  DataTable,
  Field,
  Input,
  LoadingState,
  MetricLabel,
  SectionCard,
  Select,
  StatusDot,
  actionErrorMessage,
  useToast,
  type BadgeTone,
  type Column,
  type IconTone,
} from "@/components/ui";

const POLL_MS = 2000;
/** Hora Chile para el aviso de «sin actualizar desde»: nunca UTC en pantalla. */
const horaChile = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Las métricas del día cambian por minuto, no por segundo. */
const WALLBOARD_POLL_MS = 15000;

/**
 * Umbrales operativos: sobre estos valores el estado se marca en rojo. La
 * pausa usa el tope de su motivo; los 15 minutos quedan para motivos sin tope.
 */
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
  | "contact-rate"
  | "effective-contacts"
  | "attempts-per-contact"
  | "sales-today"
  | "funnel"
  | "tmo"
  | "tmc"
  | "production"
  | "technical-failures"
  | "hourly"
  | "pause-reasons"
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

// Primero el embudo COPC outbound (contactabilidad, titular, venta), después la
// telefonía y los tiempos, y al final el estado del equipo.
const DEFAULT_LAYOUT: WidgetLayout[] = [
  { i: "contact-rate", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "effective-contacts", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "sales-today", x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "attempts-per-contact", x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "funnel", x: 0, y: 3, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "hourly", x: 6, y: 3, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "abandon-rate", x: 0, y: 9, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "no-answer-rate", x: 3, y: 9, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "technical-failures", x: 6, y: 9, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "answered", x: 9, y: 9, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "tmo", x: 0, y: 12, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "tmc", x: 3, y: 12, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "production", x: 6, y: 12, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "completed", x: 9, y: 12, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "occupancy", x: 0, y: 15, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "connected", x: 3, y: 15, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "available", x: 6, y: 15, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "on-call", x: 9, y: 15, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "wrap-up", x: 0, y: 18, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "paused", x: 3, y: 18, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "alerts", x: 6, y: 18, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "campaigns", x: 9, y: 18, w: 3, h: 3, minW: 2, minH: 2 },
  { i: "pause-reasons", x: 0, y: 21, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "status-chart", x: 6, y: 21, w: 6, h: 6, minW: 4, minH: 5 },
  { i: "campaign-chart", x: 0, y: 27, w: 12, h: 6, minW: 4, minH: 5 },
  { i: "queues", x: 0, y: 33, w: 12, h: 6, minW: 6, minH: 3 },
  { i: "agents", x: 0, y: 39, w: 12, h: 10, minW: 6, minH: 6 },
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
  answered: "Conectados hoy",
  completed: "Completadas hoy",
  "abandon-rate": "Abandono hoy",
  "no-answer-rate": "Sin respuesta hoy",
  "contact-rate": "Contactabilidad hoy",
  "effective-contacts": "Contacto titular",
  "attempts-per-contact": "Intentos por contacto",
  "sales-today": "Ventas hoy",
  funnel: "Embudo COPC",
  tmo: "TMO del día",
  tmc: "Tiempo de conversación",
  production: "Producción del día",
  "technical-failures": "Fallas de troncal",
  hourly: "Curva por hora",
  "pause-reasons": "Pausa por motivo",
  "status-chart": "Estados del equipo",
  "campaign-chart": "Actividad por campaña",
  queues: "Salud de campañas",
  agents: "Detalle de ejecutivos",
};

const WIDGET_KICKER: Record<WidgetId, string> = {
  occupancy: "Capacidad",
  connected: "Presencia",
  available: "Preparados",
  "on-call": "Conversación",
  "wrap-up": "Post-llamada",
  paused: "Auxiliar",
  alerts: "Atención",
  campaigns: "Operación",
  answered: "Conectado ÷ recorrido",
  completed: "Resultado",
  "abandon-rate": "Guardarraíl",
  "no-answer-rate": "Contacto",
  "contact-rate": "Aló ÷ recorrido",
  "effective-contacts": "Titular ÷ recorrido",
  "attempts-per-contact": "Costo de contacto",
  "sales-today": "Resultado comercial",
  funnel: "COPC outbound",
  tmo: "Tiempo medio de operación",
  tmc: "Conversación",
  production: "Producción",
  "technical-failures": "Telefonía",
  hourly: "Ritmo de la jornada",
  "pause-reasons": "Auxiliares",
  "status-chart": "Lectura del equipo",
  "campaign-chart": "Pulso de campañas",
  queues: "Salud operacional",
  agents: "Seguimiento en vivo",
};

/**
 * Chip de cada tarjeta, con la convención de color del menú: voz en el color
 * de marca, equipo en azul, tiempos en ámbar, ventas en verde, análisis en
 * violeta, campañas y pausas en rosa, telefonía técnica en gris.
 */
const WIDGET_ICON: Record<WidgetId, { icon: LucideIcon; tone: IconTone }> = {
  occupancy: { icon: Gauge, tone: "blue" },
  connected: { icon: Users, tone: "blue" },
  available: { icon: UserCheck, tone: "green" },
  "on-call": { icon: PhoneCall, tone: "primary" },
  "wrap-up": { icon: ClipboardPen, tone: "amber" },
  paused: { icon: Coffee, tone: "rose" },
  alerts: { icon: TriangleAlert, tone: "rose" },
  campaigns: { icon: Megaphone, tone: "rose" },
  answered: { icon: PhoneIncoming, tone: "primary" },
  completed: { icon: CircleCheck, tone: "green" },
  "abandon-rate": { icon: PhoneOff, tone: "rose" },
  "no-answer-rate": { icon: PhoneMissed, tone: "amber" },
  "contact-rate": { icon: Target, tone: "teal" },
  "effective-contacts": { icon: BadgeCheck, tone: "teal" },
  "attempts-per-contact": { icon: Repeat, tone: "slate" },
  "sales-today": { icon: Trophy, tone: "green" },
  funnel: { icon: Funnel, tone: "violet" },
  tmo: { icon: Timer, tone: "amber" },
  tmc: { icon: Clock, tone: "amber" },
  production: { icon: ClipboardList, tone: "violet" },
  "technical-failures": { icon: ServerCrash, tone: "slate" },
  hourly: { icon: Activity, tone: "teal" },
  "pause-reasons": { icon: Coffee, tone: "rose" },
  "status-chart": { icon: ChartPie, tone: "blue" },
  "campaign-chart": { icon: Megaphone, tone: "rose" },
  queues: { icon: Layers, tone: "rose" },
  agents: { icon: Users, tone: "blue" },
};

/** Con estado de alerta el chip toma el color del estado, como MetricCard. */
const ALERT_CHIP: Partial<Record<"default" | "warn" | "danger" | "good", IconTone>> = { warn: "amber", danger: "rose" };

function WidgetChip({ id, tone }: { id: WidgetId; tone?: IconTone }) {
  const { icon: Icon, tone: own } = WIDGET_ICON[id];
  return (
    <span className="icon-chip size-7 rounded-lg" data-tone={tone ?? own} aria-hidden="true">
      <Icon size={14} />
    </span>
  );
}

/** Cabecera de las tarjetas grandes: icono plano, antetítulo y título. */
function WidgetHeader({ id, title, description }: { id: WidgetId; title: string; description: ReactNode }) {
  const { icon: Icon } = WIDGET_ICON[id];
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-medium text-muted-foreground">
          {WIDGET_KICKER[id]}
        </p>
      </div>
      <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

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

/** Tope en segundos por motivo de pausa (reason_id). */
type PauseCaps = ReadonlyMap<string, number>;

type AgentDisplay = {
  label: string;
  tone: BadgeTone;
  since: string | null;
  alert: boolean;
  /** "excedida por X min" cuando la pausa pasó el tope de su motivo. */
  exceeded?: string | null;
};

function agentDisplay(agent: AgentLiveStatus, now: number, caps: PauseCaps): AgentDisplay {
  if (agent.phone_status === "on_call") return { label: "En llamada", tone: "info", since: agent.phone_status_since, alert: false };
  if (agent.phone_status === "ringing") return { label: "Timbrando", tone: "warning", since: agent.phone_status_since, alert: false };
  // Desconectado es ausencia, no una pausa/AUX. Fuera del horario no acumula
  // nada; dentro del horario se calcula como métrica separada en reportes.
  if (agent.reason_code === "desconectado") {
    return { label: "Desconectado", tone: "neutral", since: null, alert: false };
  }
  if (agent.is_pause && agent.reason_label) {
    const cap = agent.reason_id ? caps.get(agent.reason_id) : undefined;
    if (cap != null) {
      const estado = estadoDeTope({ since: agent.reason_since, maxSeconds: cap, isPause: true, now });
      return {
        label: agent.reason_label,
        tone: "danger",
        since: agent.reason_since,
        alert: estado.tipo === "excedida",
        exceeded: avisoParaSupervisor(estado),
      };
    }
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

function MetricWidget({ id, label, value, hint, tone = "default", metric, children }: { id: WidgetId; label: string; value: string | number; hint?: ReactNode; tone?: "default" | "warn" | "danger" | "good"; metric?: MetricId; children?: ReactNode }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "text-foreground";
  const chipTone = ALERT_CHIP[tone] ?? WIDGET_ICON[id].tone;
  return (
    <div className="relative flex h-full min-h-32 flex-col justify-between overflow-hidden">
      <div>
        <div className="mb-3 flex items-center gap-2.5">
          <WidgetChip id={id} tone={chipTone} />
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {WIDGET_KICKER[id]}
          </p>
        </div>
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {metric ? <MetricLabel id={metric} /> : label}
        </p>
        <p className={cn("mt-1.5 text-4xl font-semibold tabular-nums tracking-[-0.06em]", color)}>{value}</p>
      </div>
      {(hint || children) && <div className="mt-4 border-t border-border/70 pt-2.5 text-xs leading-relaxed text-muted-foreground">{hint}{children}</div>}
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
}

/** Desglose de los conectados que no fueron aló, según la tipificación. */
function conectadosSinAlo(detalle: ConectadosSinAlo | undefined): string {
  if (!detalle) return "—";
  const partes = [
    [detalle.buzon, "buzón de voz"],
    [detalle.no_contesta, "no contesta"],
    [detalle.fuera_servicio, "fuera de servicio"],
    [detalle.sin_tipificar, "sin tipificar"],
    [detalle.otro, "otro"],
  ] as const;
  const texto = partes.filter(([n]) => n > 0).map(([n, etiqueta]) => `${formatInt(n)} ${etiqueta}`).join(" · ");
  return texto || "ninguno";
}

function formatRatio(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function QueueHealthCard({ queue, funnel }: { queue: QueueHealth; funnel?: EmbudoCopc }) {
  const handled = queue.answered_today + queue.abandoned_today;
  const abandonRate = handled > 0 ? Math.round((queue.abandoned_today / handled) * 100) : 0;
  const overThreshold = abandonRate > THRESHOLDS.abandonRate;
  return (
    <div className="rounded-xl border border-border bg-surface-muted/40 p-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <p className="text-sm font-semibold text-foreground">{queue.campaign_name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Cola · {queue.queue_name}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="info">Contactabilidad {formatPercent(funnel?.contactabilidad)}</Badge>
          <Badge tone={overThreshold ? "danger" : "neutral"}>Abandono {abandonRate}%</Badge>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <QueueNumber label="Recorridos" value={funnel?.recorridos ?? 0} edge="var(--tone-teal)" />
        <QueueNumber label="Conectados" value={funnel?.conectados ?? 0} edge="var(--tone-slate)" />
        <QueueNumber label="Aló" value={funnel?.contactados ?? 0} edge="var(--primary)" />
        <QueueNumber label="Titular" value={funnel?.titulares ?? 0} edge="var(--tone-violet)" />
        <QueueNumber label="Ventas" value={funnel?.ventas ?? 0} edge="var(--success)" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/70 pt-3 sm:grid-cols-4">
        <QueueNumber label="En curso" value={queue.in_flight} />
        <QueueNumber label="Llamadas conectadas" value={queue.answered_today} />
        <QueueNumber label="Completadas" value={queue.completed_today} />
        <QueueNumber label="No responde" value={queue.no_answer_today} edge={queue.no_answer_today > 0 ? "var(--warning)" : undefined} />
      </div>
    </div>
  );
}

/** Cifra en baldosa: el borde izquierdo lleva el color de la etapa. */
function QueueNumber({ label, value, edge }: { label: string; value: number; edge?: string }) {
  return (
    <div className="rounded-lg border border-border border-l-2 bg-background px-3 py-2" style={{ borderLeftColor: edge ?? "var(--border-strong)" }}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-foreground">{formatInt(value)}</p>
    </div>
  );
}

export function LiveMonitor({ canForceLogout = false }: { canForceLogout?: boolean }) {
  const [agents, setAgents] = useState<AgentLiveStatus[]>([]);
  const [queues, setQueues] = useState<QueueHealth[]>([]);
  const [wallboard, setWallboard] = useState<LiveWallboard | null>(null);
  const [pauseCaps, setPauseCaps] = useState<PauseCaps>(() => new Map());
  const [now, setNow] = useState(() => new Date().getTime());
  const [loading, setLoading] = useState(true);
  // Un sondeo fallido no borra lo que ya se ve: se guarda cuándo fue la última
  // lectura buena y el monitor avisa que está desactualizado mientras reintenta.
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveOkAt, setLiveOkAt] = useState<number | null>(null);
  const [liveRetry, setLiveRetry] = useState(0);
  const [wallboardFailed, setWallboardFailed] = useState(false);
  const [wallboardOkAt, setWallboardOkAt] = useState<number | null>(null);
  const [wallboardRetry, setWallboardRetry] = useState(0);
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
  const hourlyChartId = useChartId("curva-hora");

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
        setLiveFailed(false);
        setLiveOkAt(new Date().getTime());
      } catch (err) {
        if (disposed) return;
        console.error("Monitor: no se pudo leer el estado en vivo", err);
        setLiveFailed(true);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { disposed = true; clearInterval(id); };
  }, [liveRetry]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // Métricas del día: van aparte y más lento que el estado en vivo. Si fallan,
  // el monitor sigue funcionando y las tarjetas del día muestran guion.
  useEffect(() => {
    let disposed = false;
    async function pollWallboard() {
      try {
        const data = await getLiveWallboard();
        if (!disposed) {
          setWallboard(data);
          setWallboardFailed(false);
          setWallboardOkAt(new Date().getTime());
        }
      } catch (err) {
        console.error("Monitor: no se pudo leer el tablero del día", err);
        if (!disposed) setWallboardFailed(true);
      }
      // Los topes cambian solo cuando el admin los edita: basta con el ritmo
      // del tablero y son veinte filas del catálogo, no otra consulta en vivo.
      try {
        const caps = await getStatusReasonCaps();
        if (!disposed) setPauseCaps(new Map(caps.map((cap) => [cap.id, cap.max_seconds])));
      } catch (err) {
        console.error("Monitor: no se pudieron leer los topes de pausa", err);
      }
    }
    pollWallboard();
    const id = setInterval(pollWallboard, WALLBOARD_POLL_MS);
    return () => { disposed = true; clearInterval(id); };
  }, [wallboardRetry]);

  const todayByAgent = useMemo(
    () => new Map((wallboard?.por_ejecutivo ?? []).map((row) => [row.profile_id, row])),
    [wallboard]
  );

  const groups = useMemo(() => {
    const counters: Record<AgentGroup, number> = { available: 0, on_call: 0, wrap_up: 0, paused: 0, offline: 0 };
    for (const agent of agents) counters[groupOf(agent)] += 1;
    return counters;
  }, [agents]);
  const connected = agents.length - groups.offline;
  const occupancy = connected > 0 ? Math.round(((groups.on_call + groups.wrap_up) / connected) * 100) : 0;
  const alerts = agents.filter((agent) => agentDisplay(agent, now, pauseCaps).alert).length;
  const exceededPauses = agents.filter((agent) => agentDisplay(agent, now, pauseCaps).exceeded).length;
  const totals = useMemo(() => queues.reduce((all, queue) => ({ inFlight: all.inFlight + queue.in_flight, answered: all.answered + queue.answered_today, completed: all.completed + queue.completed_today, abandoned: all.abandoned + queue.abandoned_today, noAnswer: all.noAnswer + queue.no_answer_today }), { inFlight: 0, answered: 0, completed: 0, abandoned: 0, noAnswer: 0 }), [queues]);
  const abandonRate = totals.answered + totals.abandoned > 0 ? Math.round((totals.abandoned / (totals.answered + totals.abandoned)) * 100) : 0;
  const noAnswerRate = totals.answered + totals.noAnswer > 0 ? Math.round((totals.noAnswer / (totals.answered + totals.noAnswer)) * 100) : 0;
  // Embudo COPC outbound, por registro: recorrido → aló → titular → venta. La
  // contactabilidad es aló ÷ recorrido: los no contesta del discador restan
  // aunque nunca lleguen a un ejecutivo. Sin datos se muestra guion, no un cero
  // que parezca un resultado.
  const funnel = wallboard?.embudo ?? null;
  const funnelByCampaign = useMemo(
    () => new Map((wallboard?.por_campana ?? []).map((row) => [row.campaign_id, row])),
    [wallboard]
  );
  const campaignOptions = useMemo(() => [...new Set(agents.map((agent) => agent.campaign_name).filter((name): name is string => Boolean(name)))].sort(), [agents]);
  const normalizedTerm = term.trim().toLocaleLowerCase("es-CL");
  const filteredAgents = useMemo(() => agents.filter((agent) => {
    if (group && groupOf(agent) !== group) return false;
    if (campaign && agent.campaign_name !== campaign) return false;
    return !normalizedTerm || `${agent.full_name} ${agent.extension}`.toLocaleLowerCase("es-CL").includes(normalizedTerm);
  }), [agents, group, campaign, normalizedTerm]);
  const statusChartData = (Object.keys(GROUP_LABEL) as AgentGroup[]).map((key) => ({ name: GROUP_LABEL[key], value: groups[key], color: STATUS_COLORS[key] }));
  const campaignChartData = queues.map((queue) => ({ name: queue.campaign_name.length > 18 ? `${queue.campaign_name.slice(0, 16)}…` : queue.campaign_name, fullName: queue.campaign_name, "En curso": queue.in_flight, Conectadas: queue.answered_today, Completadas: queue.completed_today }));
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
          message: actionErrorMessage(err),
        });
      }
    });
  }

  const columns = useMemo<Column<AgentLiveStatus>[]>(() => [
    { id: "ejecutivo", header: "Ejecutivo", value: (row) => row.full_name },
    { id: "extension", header: "Extensión", value: (row) => row.extension, className: "text-muted-foreground" },
    { id: "campana", header: "Campaña", value: (row) => row.campaign_name ?? "", cell: (row) => row.campaign_name ?? "—", className: "text-muted-foreground" },
    { id: "estado", header: "Estado", value: (row) => agentDisplay(row, now, pauseCaps).label, cell: (row) => { const { label, tone, exceeded } = agentDisplay(row, now, pauseCaps); return <span className="inline-flex flex-wrap items-center gap-2"><StatusDot tone={tone} />{label}{exceeded && <span className="rounded-md border border-danger bg-danger-bg px-1.5 py-0.5 text-[11px] font-semibold text-danger">{exceeded}</span>}</span>; } },
    { id: "gestiones-hoy", header: "Gestiones hoy", align: "right", value: (row) => todayByAgent.get(row.profile_id)?.gestiones ?? 0, cell: (row) => { const today = todayByAgent.get(row.profile_id); return <span className="tabular-nums">{today ? `${today.gestiones} · ${today.contactos} ctc` : "—"}</span>; } },
    { id: "tmo-hoy", header: "TMO hoy", align: "right", value: (row) => todayByAgent.get(row.profile_id)?.tmo_segundos ?? -1, cell: (row) => <span className="tabular-nums">{formatElapsed(todayByAgent.get(row.profile_id)?.tmo_segundos ?? null)}</span> },
    { id: "pausa-hoy", header: "Pausa hoy", align: "right", value: (row) => todayByAgent.get(row.profile_id)?.pausa_segundos ?? 0, cell: (row) => { const today = todayByAgent.get(row.profile_id); const detail = (today?.pausa_por_motivo ?? []).map((item) => `${item.motivo}: ${formatElapsed(item.segundos)}`).join(" · "); return <span className="tabular-nums" title={detail || undefined}>{today && today.pausa_segundos > 0 ? formatElapsed(today.pausa_segundos) : "—"}</span>; } },
    { id: "tiempo", header: "Tiempo en estado", align: "right", value: (row) => elapsedSeconds(agentDisplay(row, now, pauseCaps).since, now) ?? -1, cell: (row) => { const { since, alert } = agentDisplay(row, now, pauseCaps); return <span className={alert ? "font-medium text-danger" : "tabular-nums"}>{formatElapsed(elapsedSeconds(since, now))}{alert && " ⚠"}</span>; } },
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
              <span className="text-xs text-success">
                {row.control_browser_acknowledged_at ? "Navegador y PBX confirmados" : "PBX confirmado"}
              </span>
            )}
          </div>
        );
      },
    }] : []),
  ], [now, canForceLogout, openLogoutDialog, todayByAgent, pauseCaps]);


  const today = wallboard?.hoy ?? null;
  // Si el tablero del día nunca llegó, las tarjetas no se quedan en
  // «Calculando…» para siempre: dicen que no hay datos y el aviso de arriba
  // ofrece reintentar.
  const pendingHint = wallboardFailed && !wallboard ? "Sin datos por ahora" : "Calculando…";
  const hourlyData = (wallboard?.por_hora ?? []).map((row) => ({ name: `${String(row.hora).padStart(2, "0")}h`, Recorridos: row.recorridos ?? 0, Conectados: row.conectados ?? 0, "Aló": row.contactados ?? 0, Titular: row.titulares ?? 0, Contactabilidad: row.recorridos ? `${Math.round(((row.contactados ?? 0) / row.recorridos) * 1000) / 10}%` : "—" }));
  const pauseTotal = (wallboard?.pausa_equipo ?? []).reduce((sum, item) => sum + item.segundos, 0);
  const widgets: Record<WidgetId, ReactNode> = {
    occupancy: <MetricWidget id="occupancy" label="Ocupación del equipo" metric="ocupacion" value={`${occupancy}%`} hint={`${connected} conectados · objetivo operativo 85%`} tone={occupancy >= 85 ? "warn" : "default"} />,
    connected: <MetricWidget id="connected" label="Equipo conectado" value={connected} hint={`de ${agents.length} ejecutivos`} />,
    available: <MetricWidget id="available" label="Disponibles" value={groups.available} hint={connected ? `${Math.round((groups.available / connected) * 100)}% del equipo conectado` : "Sin equipo conectado"} tone={groups.available === 0 && connected > 0 ? "warn" : "good"} />,
    "on-call": <MetricWidget id="on-call" label="En llamada" value={groups.on_call} hint={`${groups.on_call + groups.wrap_up} trabajando llamadas`} />,
    "wrap-up": <MetricWidget id="wrap-up" label="En cierre" value={groups.wrap_up} hint="Incluye interrupción legal y ACW" tone={groups.wrap_up > 0 ? "warn" : "default"} />,
    paused: <MetricWidget id="paused" label="En pausa" value={groups.paused} hint={exceededPauses ? `${exceededPauses} ${exceededPauses === 1 ? "excedió" : "excedieron"} el tope de su pausa` : "Fuera de la cola por AUX"} tone={exceededPauses ? "danger" : groups.paused > 0 ? "warn" : "default"} />,
    alerts: <MetricWidget id="alerts" label="Alertas operativas" value={alerts} hint={alerts ? "Pausa o cierre fuera de umbral" : "Todo dentro de los umbrales"} tone={alerts ? "danger" : "good"} />,
    campaigns: <MetricWidget id="campaigns" label="Campañas activas" value={queues.length} hint={`${totals.inFlight} llamadas en curso`} />,
    answered: <MetricWidget id="answered" label="Conectados hoy" metric="conectados" value={funnel ? formatInt(funnel.conectados) : "—"} hint={funnel ? (funnel.conectados ? `${formatPercent(funnel.tasa_conexion)} de ${formatInt(funnel.recorridos)} recorridos únicos · ${formatInt(funnel.contactados)} con aló (${formatPercent(funnel.alo_de_conectados)})` : "Nadie ha contestado todavía") : pendingHint} />,
    completed: <MetricWidget id="completed" label="Completadas hoy" value={formatInt(totals.completed)} hint={totals.answered ? `${Math.round((totals.completed / totals.answered) * 100)}% de las llamadas conectadas` : "Sin llamadas conectadas"} />,
    "abandon-rate": <MetricWidget id="abandon-rate" label="Abandono hoy" metric="abandono" value={`${abandonRate}%`} hint={`${formatInt(totals.abandoned)} abandonadas · umbral ${THRESHOLDS.abandonRate}%`} tone={abandonRate > THRESHOLDS.abandonRate ? "danger" : "good"} />,
    "no-answer-rate": <MetricWidget id="no-answer-rate" label="Sin respuesta hoy" value={`${noAnswerRate}%`} hint={`${formatInt(totals.noAnswer)} intentos sin respuesta`} tone={noAnswerRate >= 70 ? "warn" : "default"} />,
    "contact-rate": <MetricWidget id="contact-rate" label="Contactabilidad hoy" metric="contactabilidad" value={formatPercent(funnel?.contactabilidad)} hint={funnel ? (funnel.recorridos ? `${formatInt(funnel.contactados)} aló de ${formatInt(funnel.recorridos)} registros recorridos` : "Sin registros recorridos todavía") : pendingHint} />,
    "effective-contacts": <MetricWidget id="effective-contacts" label="Contacto titular" metric="contacto_titular" value={formatPercent(funnel?.contactabilidad_titular)} hint={funnel ? (funnel.contactados ? `${formatInt(funnel.titulares)} titulares · ${formatPercent(funnel.titularidad)} de los aló` : "Sin aló todavía") : pendingHint} />,
    "attempts-per-contact": <MetricWidget id="attempts-per-contact" label="Intentos por contacto" metric="intentos_por_contacto" value={formatRatio(funnel?.intentos_por_contacto)} hint={funnel ? (funnel.contactados ? `${formatInt(funnel.intentos)} marcaciones · intensidad ${formatRatio(funnel.intensidad)} por registro` : "Aún sin aló") : pendingHint} tone={funnel?.intentos_por_contacto != null && funnel.intentos_por_contacto > 15 ? "warn" : "default"} />,
    "sales-today": <MetricWidget id="sales-today" label="Ventas hoy" value={funnel ? formatInt(funnel.ventas) : "—"} hint={funnel ? (funnel.titulares ? `Conversión ${formatPercent(funnel.conversion)} de los contactos titulares` : "Sin contactos titulares todavía") : pendingHint} tone={funnel && funnel.ventas > 0 ? "good" : "default"} />,
    funnel: (
      <div className="flex h-[19.5rem] flex-col">
        <WidgetHeader id="funnel" title="Embudo del día" description="Toques únicos a la base: cada registro cuenta una vez al día aunque se marque varias veces. Hora Chile. Cada tasa sobre el recorrido; entre paréntesis, sobre la etapa anterior." />
        {funnel && funnel.recorridos > 0 ? (
          <div className="mt-3 flex-1 space-y-2">
            {([
              { label: "Recorridos únicos", value: funnel.recorridos, color: CHART_COLOR.teal, step: null, stepLabel: `${formatInt(funnel.intentos)} marcaciones · ${formatRatio(funnel.intensidad)} por registro` },
              { label: "Conectados", value: funnel.conectados, color: CHART_COLOR.slate, step: null, stepLabel: `${formatPercent(funnel.tasa_conexion)} conexión` },
              { label: "Aló", value: funnel.contactados, color: CHART_COLOR.primary, step: funnel.alo_de_conectados, stepLabel: "de los conectados" },
              { label: "Titular", value: funnel.titulares, color: CHART_COLOR.violet, step: funnel.titularidad, stepLabel: "de los aló" },
              { label: "Ventas", value: funnel.ventas, color: CHART_COLOR.green, step: funnel.conversion, stepLabel: "conversión" },
            ]).map((stage) => {
              const share = Math.round((stage.value / funnel.recorridos) * 1000) / 10;
              return (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><i className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />{stage.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">{formatInt(stage.value)}</span>
                      {stage.step === null ? ` · ${stage.stepLabel}` : ` · ${formatPercent(share)} (${formatPercent(stage.step)} ${stage.stepLabel})`}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(share, stage.value > 0 ? 1 : 0)}%`, background: stage.color }} />
                  </div>
                </div>
              );
            })}
            <p className="border-t border-border/70 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Conectados sin aló: {conectadosSinAlo(funnel.conectados_sin_alo)}
            </p>
          </div>
        ) : <EmptyState icon={Funnel} title={funnel ? "Sin registros recorridos todavía." : pendingHint} className="flex-1 py-0" />}
      </div>
    ),
    tmo: <MetricWidget id="tmo" label="TMO del día" value={formatElapsed(today?.tmo_segundos ?? null)} hint={today ? `Gestión completa, de abrir a tipificar · con contacto ${formatElapsed(today.tmo_contacto_segundos)}` : pendingHint} />,
    tmc: <MetricWidget id="tmc" label="Tiempo de conversación" value={formatElapsed(today?.tmc_segundos ?? null)} hint={today ? `Promedio por llamada conectada · ${formatInt(today.discador_conectadas)} conectadas hoy` : pendingHint} />,
    production: <MetricWidget id="production" label="Producción del día" value={today ? formatInt(today.gestiones) : "—"} hint={today ? `Gestiones cerradas del equipo · ${formatInt(today.contactos)} con aló · ${formatInt(today.ventas)} ventas · ${formatInt(today.cotizaciones)} cotizaciones · ${formatInt(today.agendas)} agendas` : pendingHint} tone={today && today.ventas > 0 ? "good" : "default"} />,
    "technical-failures": <MetricWidget id="technical-failures" label="Fallas de troncal" value={today?.fallas_tecnicas == null ? "—" : `${today.fallas_tecnicas}%`} hint={today ? `Intentos que no alcanzaron a sonar · ${formatInt(today.discador_intentos)} intentos hoy · abandono ${today.abandono ?? 0}%` : pendingHint} tone={today?.fallas_tecnicas != null && today.fallas_tecnicas >= 30 ? "danger" : today?.fallas_tecnicas != null && today.fallas_tecnicas >= 10 ? "warn" : "good"} />,
    hourly: (
      <div className="h-[19.5rem]">
        <WidgetHeader id="hourly" title="Curva por hora" description="Registros recorridos, conectados, con aló y con titular en cada hora de hoy, hora Chile." />
        {hourlyData.length ? (
          <ResponsiveContainer width="100%" height="72%">
            <BarChart data={hourlyData} margin={{ top: 16, left: -12, right: 8, bottom: 0 }} barCategoryGap="22%" barGap={2}>
              {chartGradients(hourlyChartId, ["teal", "slate", "primary", "violet"])}
              <CartesianGrid {...CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip cursor={CHART_CURSOR} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} labelFormatter={(label, payload) => `${label} · contactabilidad ${payload?.[0]?.payload?.Contactabilidad ?? "—"}`} />
              <Bar dataKey="Recorridos" fill={gradientUrl(hourlyChartId, "teal")} radius={[5, 5, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Conectados" fill={gradientUrl(hourlyChartId, "slate")} radius={[5, 5, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Aló" fill={gradientUrl(hourlyChartId, "primary")} radius={[5, 5, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Titular" fill={gradientUrl(hourlyChartId, "violet")} radius={[5, 5, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState icon={Activity} title="Sin actividad todavía." className="h-48 py-0" />}
      </div>
    ),
    "pause-reasons": (
      <div className="h-[19.5rem] overflow-y-auto">
        <WidgetHeader id="pause-reasons" title="Pausa por motivo" description="Tiempo acumulado hoy del equipo y quiénes están en pausa ahora." />
        <div className="mt-4 space-y-2.5">
          {(wallboard?.pausa_equipo ?? []).length === 0 && <EmptyState icon={Coffee} title="Sin pausas registradas hoy." className="py-6" />}
          {(wallboard?.pausa_equipo ?? []).map((item) => {
            const pausedNow = wallboard?.estado.pausa_por_motivo.find((row) => row.motivo === item.motivo)?.ejecutivos ?? 0;
            const share = pauseTotal > 0 ? Math.round((item.segundos / pauseTotal) * 100) : 0;
            return (
              <div key={item.motivo}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{item.motivo}{pausedNow > 0 && <span className="ml-1.5 text-danger">· {pausedNow} ahora</span>}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{formatElapsed(item.segundos)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-tone-rose" style={{ width: `${share}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    "status-chart": (
      <div className="h-[19.5rem]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <WidgetHeader id="status-chart" title="Distribución del equipo" description="Lectura de disponibilidad en este instante." />
          </div>
          <div className="rounded-lg border border-border border-r-2 border-r-[color:var(--tone-blue)] bg-background px-3 py-2 text-right">
            <p className="text-xs font-medium text-muted-foreground">Conectados</p>
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
              <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="84%" paddingAngle={3} cornerRadius={5} stroke="none">
                {statusChartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                <Label value={`${occupancy}%`} position="center" className="fill-foreground text-2xl font-semibold" />
              </Pie>
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} formatter={(value) => [formatInt(Number(value)), "Ejecutivos"]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    ),
    "campaign-chart": (
      <div className="h-[19.5rem]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <WidgetHeader id="campaign-chart" title="Actividad por campaña" description="Acumulado de jornada y carga que sigue activa." />
          </div>
          <div className="flex flex-col gap-1 text-right text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm" style={{ backgroundColor: CHART_COLOR.teal }} />En curso</span>
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm" style={{ backgroundColor: CHART_COLOR.primary }} />Conectadas</span>
            <span className="inline-flex items-center justify-end gap-1.5"><i className="size-2 rounded-sm" style={{ backgroundColor: CHART_COLOR.green }} />Completadas</span>
          </div>
        </div>
        {campaignChartData.length ? (
          <ResponsiveContainer width="100%" height="76%">
            <BarChart data={campaignChartData} margin={{ top: 16, left: -12, right: 8, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid {...CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...CHART_AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip cursor={CHART_CURSOR} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""} />
              <Bar dataKey="En curso" stackId="a" fill={CHART_COLOR.teal} radius={[0, 0, 4, 4]} maxBarSize={44} />
              <Bar dataKey="Conectadas" stackId="a" fill={CHART_COLOR.primary} maxBarSize={44} />
              <Bar dataKey="Completadas" stackId="a" fill={CHART_COLOR.green} radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState icon={Megaphone} title="No hay campañas activas." className="h-48 py-0" />}
      </div>
    ),
    queues: (
      <SectionCard className="rounded-xl border-border" icon={Layers} tone="rose" title={<span className="text-base tracking-tight">Salud de las colas</span>} description={`Actualizado automáticamente cada ${POLL_MS / 1000} segundos.`} actions={<span className="hidden sm:inline-flex">{liveFailed ? <Badge tone="warning">Sin actualizar</Badge> : <Badge tone="success">En vivo</Badge>}</span>}>
        <div className="space-y-3 p-4">{queues.length === 0 ? <EmptyState icon={Megaphone} title="No hay campañas activas para el motor de discado." className="py-8" /> : queues.map((queue) => <QueueHealthCard key={queue.campaign_id} queue={queue} funnel={funnelByCampaign.get(queue.campaign_id)} />)}</div>
      </SectionCard>
    ),
    agents: (
      <SectionCard className="rounded-xl border-border" icon={Users} tone="blue" title={<span className="text-base tracking-tight">Ejecutivos <span className="font-mono text-sm font-medium text-muted-foreground">({filteredAgents.length})</span></span>} description={alerts > 0 ? `${alerts} sobre el umbral${exceededPauses ? ` (${exceededPauses} ${exceededPauses === 1 ? "pausa excedida" : "pausas excedidas"})` : ""}: pausa sobre el tope de su motivo (${THRESHOLDS.pauseSeconds / 60} minutos si no tiene) o cierre de llamada sobre ${THRESHOLDS.wrapUpSeconds} segundos.` : `Se sincroniza cada ${POLL_MS / 1000} segundos.`}>
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
  if (liveFailed && liveOkAt === null) {
    return (
      <Callout tone="danger">
        <p className="font-medium">No se pudo conectar el monitor en vivo.</p>
        <p className="mt-1">Atlas sigue reintentando cada {POLL_MS / 1000} segundos. Si no se conecta en un minuto, revisa tu conexión o avisa a soporte.</p>
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setLiveRetry((value) => value + 1)}>
          <RotateCcw size={14} aria-hidden="true" /> Reintentar ahora
        </Button>
      </Callout>
    );
  }
  const staleNotices = [
    liveFailed && liveOkAt !== null ? `Estado de los ejecutivos sin actualizar desde las ${horaChile.format(liveOkAt)}` : null,
    wallboardFailed ? (wallboardOkAt !== null ? `Métricas del día sin actualizar desde las ${horaChile.format(wallboardOkAt)}` : "Las métricas del día no se pudieron leer") : null,
  ].filter((notice): notice is string => Boolean(notice));
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
          <p className="text-xs font-medium text-danger">Cierre de sesión forzado</p>
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
      {staleNotices.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-foreground">
          <TriangleAlert size={15} className="shrink-0 text-warning" aria-hidden="true" />
          <span>{staleNotices.join(" · ")}. Reintentando…</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              if (liveFailed) setLiveRetry((value) => value + 1);
              if (wallboardFailed) setWallboardRetry((value) => value + 1);
            }}
          >
            <RotateCcw size={14} aria-hidden="true" /> Reintentar ahora
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SavedViewsBar<MonitorPreference>
          viewKey="live-monitor"
          currentConfig={{ layout: safeLayout, hidden }}
          onApply={(config) =>
            setPreference({
              layout: config.layout ?? DEFAULT_LAYOUT,
              hidden: config.hidden ?? [],
            })
          }
        />
      </div>

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
