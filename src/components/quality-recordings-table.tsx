"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Badge, DataTable, type Column } from "@/components/ui";
import { RecordingAudioPlayer } from "@/components/recording-audio-player";
import { RecordingQualityEvaluationControl } from "@/components/recording-quality-evaluation-control";
import { RecordingTranscriptionControl } from "@/components/recording-transcription-control";
import type { QualityRecordingRow } from "@/lib/quality-recordings";
import {
  classifyRecordingIntegrity,
  qualityTypificationLabel,
} from "@/lib/quality-recording-labels";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace(",", "");
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

const columns: Column<QualityRecordingRow>[] = [
  {
    id: "startedAt",
    header: "Fecha y hora",
    className: "w-[11%]",
    value: (row) => row.startedAt,
    cell: (row) => <span className="text-foreground">{formatDateTime(row.startedAt)}</span>,
  },
  {
    id: "campaign",
    header: "Campaña",
    className: "w-[8%]",
    value: (row) => row.campaignName,
    cell: (row) => <span className="font-medium text-foreground">{row.campaignName}</span>,
  },
  { id: "agent", header: "Ejecutivo", value: (row) => row.agentName, className: "w-[8%]" },
  {
    id: "typification",
    header: "Tipificación",
    className: "w-[12%]",
    value: qualityTypificationLabel,
    cell: (row) =>
      row.typification ? (
        <span className="block min-w-0 whitespace-normal font-medium text-foreground">
          {qualityTypificationLabel(row)}
        </span>
      ) : (
        <span className="whitespace-nowrap text-muted-foreground">{qualityTypificationLabel(row)}</span>
      ),
  },
  {
    id: "client",
    header: "Cliente / RUT",
    className: "w-[16%]",
    value: (row) => `${row.leadName} ${row.rut}`,
    cell: (row) => (
      <span>
        <span className="block text-foreground">{row.leadName}</span>
        <span className="block text-xs text-muted-foreground">{row.rut}</span>
      </span>
    ),
  },
  {
    id: "disconnectParty",
    header: "Lado que finalizó",
    className: "w-[9%]",
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
      return <Badge tone={party.tone}>{party.label}</Badge>;
    },
  },
  {
    id: "integrity",
    header: "Integridad",
    className: "w-[8%]",
    tooltip: "Compara la duración del archivo con TalkTime de Asterisk; si falta, usa el tramo bridgeado durable. Tolerancia: 2 segundos.",
    value: (row) => {
      const integrity = classifyRecordingIntegrity(row);
      if (integrity === "complete") return "Completa";
      if (integrity === "incomplete") return "Incompleta";
      if (integrity === "recording") return "En curso";
      return "No verificable";
    },
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
    className: "w-[12%]",
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
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">{formatDuration(row.durationSeconds)}</span>
            <span className="text-[11px] text-muted-foreground">
              {(row.codec ?? "audio").toUpperCase()} · {formatSize(row.sizeBytes)}
            </span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <RecordingAudioPlayer recordingId={row.id} playable={row.status === "ready"} compact />
        </div>
      );
    },
  },
  {
    id: "qualityActions",
    header: "Calidad y texto",
    className: "w-[16%]",
    tooltip: "Transcribe si hace falta y puntúa el apego al guion vigente con Mercury 2; requiere revisión humana.",
    value: (row) => `${row.evaluationScore ?? "Pendiente"} · ${row.transcriptionStatus ?? "Pendiente"}`,
    exportValues: (row) => ({
      "Apego al script": row.evaluationScore,
      "Transcripción": row.transcriptionStatus === "completed" ? "Completada"
        : row.transcriptionStatus === "processing" ? "Procesando"
          : row.transcriptionStatus === "failed" ? "Con error" : "Pendiente",
    }),
    sortable: false,
    cell: (row) => (
      <div className="grid gap-1.5">
        <RecordingQualityEvaluationControl
          recordingId={row.id}
          campaignName={row.campaignName}
          playable={row.status === "ready"}
          transcriptionStatus={row.transcriptionStatus}
          eligible={row.transcriptionEligibility.eligible}
          initialStatus={row.evaluationStatus}
          initialScore={row.evaluationScore}
          initialVerdict={row.evaluationVerdict}
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
