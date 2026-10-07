"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Avatar, Badge, DataTable, type Column } from "@/components/ui";
import { RecordingAudioPlayer } from "@/components/recording-audio-player";
import { RecordingQualityEvaluationControl } from "@/components/recording-quality-evaluation-control";
import { RecordingTranscriptionControl } from "@/components/recording-transcription-control";
import type { QualityRecordingRow } from "@/lib/quality-recordings";
import {
  classifyRecordingIntegrity,
  qualityTypificationLabel,
} from "@/lib/quality-recording-labels";

/** "24 may · 09:27" en hora de Chile: el día manda, la hora acompaña. */
function formatDateTime(value: string) {
  const date = new Date(value);
  const day = date
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
    .replace(".", "");
  const time = date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Santiago",
  });
  return `${day} · ${time}`;
}

/** Las tipificaciones llegan en mayúsculas desde el flujo; se leen mejor en tipo oración. */
function sentenceCase(value: string) {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.max(0, Math.floor(seconds % 60));
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  recording: { label: "Grabando", tone: "info" },
  processing: { label: "Procesando", tone: "info" },
  uploading: { label: "Subiendo", tone: "warning" },
  ready: { label: "Disponible", tone: "success" },
  failed: { label: "Con error", tone: "danger" },
  archived: { label: "Archivada", tone: "neutral" },
  deleted: { label: "Eliminada", tone: "neutral" },
};

const DISCONNECT_PARTY: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  agent: { label: "Lado ejecutivo", tone: "warning" },
  caller: { label: "Cliente", tone: "neutral" },
  transfer: { label: "Transferida", tone: "info" },
};

function disconnectPartyLabel(row: QualityRecordingRow) {
  if (row.disconnectParty) return DISCONNECT_PARTY[row.disconnectParty]?.label ?? "No determinado";
  return row.endedAt ? "No informado" : "En curso";
}

function integrityLabel(row: QualityRecordingRow) {
  const integrity = classifyRecordingIntegrity(row);
  if (integrity === "complete") return "Completa";
  if (integrity === "incomplete") return "Incompleta";
  if (integrity === "recording") return "En curso";
  return "No verificable";
}

function transcriptionLabel(row: QualityRecordingRow) {
  return row.transcriptionStatus === "completed" ? "Completada"
    : row.transcriptionStatus === "processing" ? "Procesando"
      : row.transcriptionStatus === "failed" ? "Con error" : "Pendiente";
}

/** "24 may" y "09:27" por separado, para la celda de dos líneas. */
function dayAndTime(value: string) {
  const [day, time] = formatDateTime(value).split(" · ");
  return { day, time };
}

/*
 * Columnas al estilo de Gong/Chorus: cada fila es una llamada con quién la
 * hizo (avatar), con quién, cómo terminó, el audio y el puntaje. Se conservan
 * las nueve columnas y sus valores de exportación (los fija
 * tests/quality-recordings-table.test.ts); lo que cambia es cómo se ve cada celda.
 */
const columns: Column<QualityRecordingRow>[] = [
  {
    id: "startedAt",
    header: "Fecha y hora",
    className: "w-[8%]",
    value: (row) => row.startedAt,
    cell: (row) => {
      const { day, time } = dayAndTime(row.startedAt);
      return (
        <span className="block whitespace-nowrap">
          <span className="block text-foreground">{day}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">{time}</span>
        </span>
      );
    },
  },
  {
    id: "campaign",
    header: "Campaña",
    className: "w-[10%]",
    value: (row) => row.campaignName,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={row.campaignName} shape="square" size="xs" />
        <span className="min-w-0 truncate text-foreground" title={row.campaignName}>{row.campaignName}</span>
      </span>
    ),
  },
  {
    id: "agent",
    header: "Ejecutivo",
    className: "w-[11%]",
    value: (row) => row.agentName,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={row.agentName} size="sm" />
        <span className="min-w-0 truncate font-medium text-foreground" title={row.agentName}>{row.agentName}</span>
      </span>
    ),
  },
  {
    id: "typification",
    header: "Tipificación",
    className: "w-[11%]",
    value: qualityTypificationLabel,
    cell: (row) => (
      <span
        className={
          row.typification
            ? "block min-w-0 whitespace-normal font-medium text-foreground"
            : "block min-w-0 whitespace-normal text-muted-foreground"
        }
      >
        {sentenceCase(qualityTypificationLabel(row))}
      </span>
    ),
  },
  {
    id: "client",
    header: "Cliente / RUT",
    className: "w-[13%]",
    value: (row) => `${row.leadName} ${row.rut}`,
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate text-foreground" title={row.leadName}>{row.leadName}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">{row.rut}</span>
      </span>
    ),
  },
  {
    id: "disconnectParty",
    header: "Lado que finalizó",
    className: "w-[8%]",
    tooltip: "Lado técnico informado por AgentComplete. El motor también correlaciona por extensión cuando Asterisk omite los IDs; no prueba intención humana.",
    value: disconnectPartyLabel,
    cell: (row) => {
      if (!row.disconnectParty) {
        return <span className="text-muted-foreground">{disconnectPartyLabel(row)}</span>;
      }
      const party = DISCONNECT_PARTY[row.disconnectParty] ?? {
        label: "No determinado",
        tone: "neutral" as const,
      };
      return party.tone === "neutral" ? <span className="text-foreground">{party.label}</span> : <Badge tone={party.tone}>{party.label}</Badge>;
    },
  },
  {
    id: "integrity",
    header: "Integridad",
    className: "w-[8%]",
    tooltip: "Compara la duración del archivo con TalkTime de Asterisk; si falta, usa el tramo bridgeado durable. Tolerancia: 2 segundos.",
    value: integrityLabel,
    cell: (row) => {
      const integrity = classifyRecordingIntegrity(row);
      if (integrity === "complete") {
        return (
          <span
            title={
              row.talkTimeSource === "dial_attempt"
                ? "Verificada contra la duración bridgeada de la llamada."
                : "Verificada contra TalkTime de Asterisk."
            }
          >
            <Badge tone="success">Completa</Badge>
          </span>
        );
      }
      if (integrity === "incomplete") return <Badge tone="danger">Incompleta</Badge>;
      return (
        <span className="text-muted-foreground">
          {integrity === "recording" ? "En curso" : "No verificable"}
        </span>
      );
    },
  },
  {
    id: "recording",
    header: "Grabación",
    className: "w-[16%]",
    value: (row) => `${formatDuration(row.durationSeconds)} · ${(row.codec ?? "audio").toUpperCase()} · ${formatSize(row.sizeBytes)} · ${STATUS[row.status]?.label ?? row.status}`,
    exportValues: (row) => ({
      "Duración": row.durationSeconds,
      Archivo: row.sizeBytes,
      Estado: STATUS[row.status]?.label ?? row.status,
    }),
    sortable: false,
    cell: (row) => {
      const status = STATUS[row.status] ?? { label: row.status, tone: "neutral" as const };
      return (
        <div className="min-w-0 space-y-1">
          <RecordingAudioPlayer recordingId={row.id} playable={row.status === "ready"} compact />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{formatDuration(row.durationSeconds)}</span>
            <span>{(row.codec ?? "audio").toUpperCase()} · {formatSize(row.sizeBytes)}</span>
            {row.status !== "ready" && <Badge tone={status.tone}>{status.label}</Badge>}
          </p>
        </div>
      );
    },
  },
  {
    id: "qualityActions",
    header: "Calidad",
    className: "w-[15%]",
    tooltip: "Transcribe si hace falta y puntúa la llamada con la pauta de su campaña; la nota oficial es la que valida Calidad.",
    value: (row) => `${row.evaluationScore ?? "Pendiente"} · ${row.transcriptionStatus ?? "Pendiente"}`,
    exportValues: (row) => ({
      "Apego al script": row.evaluationScore,
      "Transcripción": transcriptionLabel(row),
    }),
    sortable: false,
    cell: (row) => (
      <div className="grid min-w-0 gap-1">
        <RecordingQualityEvaluationControl
          recordingId={row.id}
          campaignName={row.campaignName}
          playable={row.status === "ready"}
          transcriptionStatus={row.transcriptionStatus}
          eligible={row.transcriptionEligibility.eligible}
          initialStatus={row.evaluationStatus}
          initialScore={row.evaluationScore}
          initialVerdict={row.reviewVerdict ?? row.evaluationVerdict}
          hasPauta={row.hasPauta}
          reviewScore={row.reviewScore}
          compact
        />
        <RecordingTranscriptionControl
          recordingId={row.id}
          playable={row.status === "ready"}
          initialStatus={row.transcriptionStatus}
          eligible={row.transcriptionEligibility.eligible}
          eligibilityLabel={row.transcriptionEligibility.label}
          compact
        />
      </div>
    ),
  },
];

export function QualityRecordingsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  error,
}: {
  rows: QualityRecordingRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  error: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const goToPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    router.push(`/dashboard/calidad/grabaciones${params.size ? `?${params.toString()}` : ""}`);
  };

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      storageKey="calidad-grabaciones"
      exportFilename="grabaciones-calidad"
      emptyTitle="No hay grabaciones para este período"
      emptyDescription="Prueba ampliando el rango de fechas o quitando alguno de los filtros."
      error={error}
      page={page}
      pageCount={pageCount}
      total={total}
      serverPageSize={pageSize}
      onPageChange={goToPage}
      fitToWidth
    />
  );
}
