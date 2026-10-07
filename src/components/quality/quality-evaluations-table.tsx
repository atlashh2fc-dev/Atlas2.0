"use client";

import { TriangleAlert } from "lucide-react";
import { Avatar, Badge, DataTable, type Column } from "@/components/ui";
import { VERDICT_LABEL, VERDICT_TONE, type QualityVerdict } from "@/lib/quality-pauta";

export type EvaluationListRow = {
  recordingId: string;
  startedAt: string;
  agentName: string;
  campaignName: string;
  rubricName: string;
  typification: string | null;
  durationSeconds: number | null;
  aiScore: number | null;
  aiVerdict: QualityVerdict | null;
  score: number | null;
  verdict: QualityVerdict;
  source: "validada" | "ia";
  reviewerName: string | null;
  riskCount: number;
  criticalErrors: number;
  nonCriticalErrors: number;
};

function dateParts(value: string) {
  const date = new Date(value);
  return {
    day: date.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" }).replace(".", ""),
    time: date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }),
  };
}

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function sentenceCase(value: string) {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

const score = (value: number | null) => (value === null ? "—" : value.toLocaleString("es-CL", { maximumFractionDigits: 1 }));

const columns: Column<EvaluationListRow>[] = [
  {
    id: "startedAt",
    header: "Llamada",
    className: "w-[9%]",
    value: (row) => row.startedAt,
    cell: (row) => {
      const { day, time } = dateParts(row.startedAt);
      return (
        <span className="block whitespace-nowrap">
          <span className="block text-foreground">{day}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">{time} · {duration(row.durationSeconds)}</span>
        </span>
      );
    },
  },
  {
    id: "agent",
    header: "Ejecutivo",
    className: "w-[17%]",
    value: (row) => row.agentName,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={row.agentName} size="sm" />
        <span className="min-w-0 truncate font-medium text-foreground">{row.agentName}</span>
      </span>
    ),
  },
  {
    id: "typification",
    header: "Tipificación y rúbrica",
    className: "w-[20%]",
    value: (row) => `${row.typification ?? "Sin tipificación"} · ${row.rubricName}`,
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate text-foreground">{row.typification ? sentenceCase(row.typification) : "Sin tipificación"}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.rubricName} · {row.campaignName}</span>
      </span>
    ),
  },
  {
    id: "aiScore",
    header: "Nota IA",
    align: "right",
    value: (row) => row.aiScore,
    cell: (row) => (
      <span className="tabular-nums text-muted-foreground">
        {score(row.aiScore)}
        {row.aiVerdict && <span className="block text-[11px]">{VERDICT_LABEL[row.aiVerdict]}</span>}
      </span>
    ),
  },
  {
    id: "score",
    header: "Nota oficial",
    align: "right",
    value: (row) => row.score,
    exportValues: (row) => ({ "Nota oficial": row.score, Veredicto: VERDICT_LABEL[row.verdict], Origen: row.source === "validada" ? "Validada" : "IA" }),
    cell: (row) => (
      <span className="tabular-nums">
        <span className="text-[15px] font-semibold text-foreground">{score(row.score)}</span>
        <span className="block"><Badge tone={VERDICT_TONE[row.verdict]}>{VERDICT_LABEL[row.verdict]}</Badge></span>
      </span>
    ),
  },
  {
    id: "errors",
    header: "Errores",
    align: "right",
    value: (row) => row.criticalErrors,
    exportValues: (row) => ({ "Errores críticos": row.criticalErrors, "Errores no críticos": row.nonCriticalErrors }),
    cell: (row) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        <span className={row.criticalErrors ? "font-semibold text-danger" : "font-medium text-foreground"}>{row.criticalErrors}</span> críticos
        <span className="block">{row.nonCriticalErrors} con obs.</span>
      </span>
    ),
  },
  {
    id: "status",
    header: "Estado",
    className: "w-[14%]",
    value: (row) => (row.source === "validada" ? "Validada" : "Por validar"),
    exportValues: (row) => ({ Estado: row.source === "validada" ? "Validada" : "Por validar", "Validada por": row.reviewerName ?? "" }),
    cell: (row) => (
      <span className="block min-w-0">
        {row.source === "validada" ? <Badge tone="success">Validada</Badge> : <Badge tone="info">Por validar</Badge>}
        {row.reviewerName && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.reviewerName}</span>}
        {row.riskCount > 0 && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-danger">
            <TriangleAlert size={12} aria-hidden="true" />
            {row.riskCount} alerta{row.riskCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
    ),
  },
];

export function QualityEvaluationsTable({ rows, emptyTitle }: { rows: EvaluationListRow[]; emptyTitle: string }) {
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.recordingId}
      rowHref={(row) => `/dashboard/calidad/evaluaciones/${row.recordingId}`}
      rowActionLabel={(row) => (row.source === "validada" ? "Revisar" : "Validar")}
      storageKey="calidad-evaluaciones"
      exportFilename="evaluaciones-calidad"
      emptyTitle={emptyTitle}
      emptyDescription="Prueba ampliando el rango de fechas o quitando filtros."
      fitToWidth
    />
  );
}
