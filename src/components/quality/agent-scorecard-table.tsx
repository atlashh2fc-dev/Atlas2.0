"use client";

import { Avatar, Badge, DataTable, type Column } from "@/components/ui";

export type AgentScorecardRow = {
  agentId: string;
  agentName: string;
  evaluated: number;
  validated: number;
  averageScore: number;
  pec: number;
  penc: number;
  criticalErrors: number;
  nonCriticalErrors: number;
  minScore: number;
  maxScore: number;
  quartile: 1 | 2 | 3 | 4;
  control: "sobre" | "dentro" | "bajo";
  meetsObjective: boolean;
  objective: number;
  teamAverage: number;
  standardDeviation: number;
  lci: number;
  lcs: number;
  href: string;
};

const number = (value: number, digits = 1) => value.toLocaleString("es-CL", { maximumFractionDigits: digits });

const QUARTILE_TONE = { 1: "success", 2: "info", 3: "warning", 4: "danger" } as const;
const CONTROL = {
  sobre: { label: "Sobre LCS", tone: "success" as const },
  dentro: { label: "Dentro", tone: "neutral" as const },
  bajo: { label: "Bajo LCI", tone: "danger" as const },
};

/*
 * Mismas columnas que la «Ppt semanal» de la planilla de Calidad (Usuario,
 * Agente, Error no crítico, Error crítico, Nota final, Cuartil, Objetivo,
 * Promedio, Desv. estándar, LCI, LCS), para que la exportación la reemplace.
 */
const columns: Column<AgentScorecardRow>[] = [
  {
    id: "agent",
    header: "Ejecutivo",
    className: "w-[22%]",
    value: (row) => row.agentName,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={row.agentName} size="sm" />
        <span className="min-w-0 truncate font-medium text-foreground">{row.agentName}</span>
      </span>
    ),
  },
  {
    id: "evaluated",
    header: "Evaluadas",
    align: "right",
    value: (row) => row.evaluated,
    exportValues: (row) => ({ Evaluadas: row.evaluated, Validadas: row.validated }),
    cell: (row) => (
      <span className="tabular-nums">
        {row.evaluated}
        <span className="block text-[11px] text-muted-foreground">{row.validated} validadas</span>
      </span>
    ),
  },
  {
    id: "penc",
    header: "Sin error no crítico",
    tooltip: "PENC: % de llamadas sin atributos en «Cumple con obs.».",
    align: "right",
    value: (row) => row.penc,
    cell: (row) => <span className="tabular-nums">{number(row.penc)}%</span>,
  },
  {
    id: "pec",
    header: "Sin error crítico",
    tooltip: "PEC: % de llamadas sin atributos en «No cumple».",
    align: "right",
    value: (row) => row.pec,
    cell: (row) => <span className={row.pec < 100 ? "tabular-nums font-medium text-danger" : "tabular-nums"}>{number(row.pec)}%</span>,
  },
  {
    id: "score",
    header: "Nota final",
    align: "right",
    value: (row) => row.averageScore,
    exportValues: (row) => ({ "Nota final": row.averageScore, Mínima: row.minScore, Máxima: row.maxScore }),
    cell: (row) => (
      <span className="tabular-nums">
        <span className={`text-[15px] font-semibold ${row.meetsObjective ? "text-success" : "text-foreground"}`}>{number(row.averageScore)}</span>
        <span className="block text-[11px] text-muted-foreground">{number(row.minScore)}–{number(row.maxScore)}</span>
      </span>
    ),
  },
  {
    id: "quartile",
    header: "Cuartil",
    tooltip: "Q1 = mejor 25 % del equipo por nota final; Q4 = cuarto a trabajar.",
    value: (row) => row.quartile,
    exportValues: (row) => ({ "Cuartil NF": row.quartile }),
    cell: (row) => <Badge tone={QUARTILE_TONE[row.quartile]}>Q{row.quartile}</Badge>,
  },
  {
    id: "objective",
    header: "Objetivo",
    value: (row) => (row.meetsObjective ? "Cumple" : "Bajo objetivo"),
    exportValues: (row) => ({ Objetivo: row.objective, "Cumple objetivo": row.meetsObjective ? "Sí" : "No" }),
    cell: (row) =>
      row.meetsObjective ? <Badge tone="success">Cumple {number(row.objective)}</Badge> : <Badge tone="warning">Bajo {number(row.objective)}</Badge>,
  },
  {
    id: "control",
    header: "Control",
    tooltip: "Límites de control del equipo: promedio ± 1 desviación estándar (LCI / LCS).",
    value: (row) => CONTROL[row.control].label,
    exportValues: (row) => ({
      Promedio: row.teamAverage,
      "Desv. estándar": row.standardDeviation,
      LCI: row.lci,
      LCS: row.lcs,
      Control: CONTROL[row.control].label,
    }),
    cell: (row) => (row.control === "dentro" ? <span className="text-muted-foreground">Dentro</span> : <Badge tone={CONTROL[row.control].tone}>{CONTROL[row.control].label}</Badge>),
  },
  {
    id: "errors",
    header: "Errores",
    align: "right",
    value: (row) => row.criticalErrors,
    exportValues: (row) => ({ "Errores críticos": row.criticalErrors, "Errores no críticos": row.nonCriticalErrors }),
    cell: (row) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">{row.criticalErrors}</span> críticos · {row.nonCriticalErrors} con obs.
      </span>
    ),
  },
];

export function AgentScorecardTable({ rows }: { rows: AgentScorecardRow[] }) {
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.agentId}
      rowHref={(row) => row.href}
      rowActionLabel={() => "Ver llamadas"}
      storageKey="calidad-ejecutivos"
      exportFilename="calidad-por-ejecutivo"
      emptyTitle="Sin ejecutivos evaluados en el período"
      emptyDescription="Amplía el rango de fechas o espera la muestra automática de hoy."
      fitToWidth
    />
  );
}
