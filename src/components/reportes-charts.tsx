"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from "recharts";
import type { AgentPerformance, WorkflowCompliance } from "@/lib/types";

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

function complianceColor(rate: number | null): string {
  if (rate === null) return "var(--muted-foreground)";
  if (rate >= 80) return "#22c55e";
  if (rate >= 50) return "#f59e0b";
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
        <Bar dataKey="Conversiones" fill="#22c55e" radius={[0, 4, 4, 0]} />
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
