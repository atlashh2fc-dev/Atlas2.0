"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import type { AgentPerformance, WorkflowCompliance } from "@/lib/types";

type SupervisorTipification = {
  label: string;
  count: number;
};

type SupervisorDailyPoint = {
  day: string;
  crm_gestiones: number;
  contactos_efectivos: number;
  agendas: number;
};

type SupervisorPipelineKpis = {
  base_total: number;
  recorridos: number;
  contactados: number;
  crm_gestiones: number;
  cotizaciones: number;
  ventas: number;
};

type SupervisorAgentChartMetric = {
  full_name: string;
  crm_gestiones: number;
  contactos_efectivos: number;
  no_contacto: number;
  agendas: number;
  cotizaciones: number;
  ventas: number;
  contactabilidad: number | null;
};

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

function fmtInt(n: number): string {
  return n.toLocaleString("es-CL");
}

function fmtDay(value: string): string {
  return new Date(value).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
}

function complianceColor(rate: number | null): string {
  if (rate === null) return "var(--muted-foreground)";
  if (rate >= 80) return "var(--success)";
  if (rate >= 50) return "var(--warning)";
  return "var(--danger)";
}

/**
 * Comparación visual rápida del top de ejecutivos por gestiones, leads
 * gestionados y conversiones. La tabla detallada queda debajo para el
 * detalle fila por fila (incluye tiempo de primera respuesta).
 */
export function AgentPerformanceChart({ agents }: { agents: AgentPerformance[] }) {
  const top = agents.slice(0, 10).map((a) => ({
    name: a.full_name,
    Gestiones: a.total_interactions,
    "Leads gestionados": a.leads_managed,
    Conversiones: a.conversions,
  }));

  if (top.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin datos todavía.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, top.length * 42)}>
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={140} tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(value))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Gestiones" fill="var(--primary)" radius={[0, 4, 4, 0]} />
        <Bar dataKey="Leads gestionados" fill="var(--accent)" radius={[0, 4, 4, 0]} />
        <Bar dataKey="Conversiones" fill="var(--foreground)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * % de cumplimiento por flujo, coloreado por umbral (verde ≥80%,
 * ámbar 50-79%, rojo <50%) para detectar de un vistazo qué flujos
 * necesitan atención.
 */
export function WorkflowComplianceChart({ workflows }: { workflows: WorkflowCompliance[] }) {
  const data = workflows.map((w) => ({
    name: w.workflow_name,
    rate: w.compliance_rate,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No hay flujos configurados.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 48)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} unit="%" />
        <YAxis type="category" dataKey="name" width={150} tick={AXIS_TICK} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [value !== null ? `${value}%` : "—", "Cumplimiento"] as [string, string]}
        />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={complianceColor(entry.rate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SupervisorTipificationsChart({ tipifications }: { tipifications: SupervisorTipification[] }) {
  const top = tipifications.slice(0, 10).map((row) => ({
    name: row.label.length > 34 ? `${row.label.slice(0, 31)}...` : row.label,
    fullName: row.label,
    count: row.count,
  }));

  if (top.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin tipificaciones en el período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, top.length * 38)}>
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={190} tick={AXIS_TICK} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [fmtInt(Number(value)), "Cantidad"] as [string, string]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
        />
        <Bar dataKey="count" fill="var(--primary)" radius={[0, 5, 5, 0]}>
          {top.map((_, i) => (
            <Cell key={i} fill={i < 3 ? "var(--primary)" : "color-mix(in srgb, var(--primary) 68%, var(--accent))"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SupervisorDailyChart({ daily }: { daily: SupervisorDailyPoint[] }) {
  const data = daily.map((row) => ({
    day: fmtDay(row.day),
    Gestiones: row.crm_gestiones,
    Contactados: row.contactos_efectivos,
    Agendas: row.agendas,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin movimiento diario en el período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="day" tick={AXIS_TICK} tickMargin={8} />
        <YAxis tick={AXIS_TICK} allowDecimals={false} tickFormatter={(value) => fmtInt(Number(value))} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(value))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="Gestiones"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.12}
          strokeWidth={2}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="Contactados"
          stroke="var(--accent)"
          fill="var(--accent)"
          fillOpacity={0.16}
          strokeWidth={2}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="Agendas"
          stroke="var(--success)"
          fill="var(--success)"
          fillOpacity={0.08}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SupervisorPipelineChart({ kpis }: { kpis: SupervisorPipelineKpis }) {
  const data = [
    { name: "Base", value: kpis.base_total },
    { name: "Recorridos", value: kpis.recorridos },
    { name: "Contactados", value: kpis.contactados },
    { name: "CRM tipificado", value: kpis.crm_gestiones },
    { name: "Cotizaciones", value: kpis.cotizaciones },
    { name: "Ventas", value: kpis.ventas },
  ];

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 28, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={(value) => fmtInt(Number(value))} />
        <YAxis type="category" dataKey="name" width={120} tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(value))} />
        <Bar dataKey="value" radius={[0, 5, 5, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={
                entry.name === "Ventas"
                  ? "var(--success)"
                  : entry.name === "Cotizaciones"
                    ? "var(--warning)"
                    : "var(--primary)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SupervisorAgentFocusChart({ agents }: { agents: SupervisorAgentChartMetric[] }) {
  const data = agents
    .filter((agent) => agent.crm_gestiones > 0 || agent.contactos_efectivos > 0 || agent.no_contacto > 0)
    .sort((a, b) => b.crm_gestiones - a.crm_gestiones)
    .slice(0, 10)
    .map((agent) => ({
      name: agent.full_name,
      Contactados: agent.contactos_efectivos,
      "No contacto": agent.no_contacto,
      Agendas: agent.agendas,
      Cotizaciones: agent.cotizaciones,
      Ventas: agent.ventas,
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin gestión por ejecutivo en el período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(320, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickFormatter={(value) => fmtInt(Number(value))} />
        <YAxis type="category" dataKey="name" width={150} tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmtInt(Number(value))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Contactados" stackId="a" fill="var(--accent)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="No contacto" stackId="a" fill="var(--warning)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Agendas" stackId="a" fill="var(--primary)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Cotizaciones" stackId="a" fill="color-mix(in srgb, var(--success) 70%, var(--primary))" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Ventas" stackId="a" fill="var(--success)" radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
