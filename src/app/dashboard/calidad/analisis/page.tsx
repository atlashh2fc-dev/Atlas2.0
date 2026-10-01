import {
  AudioLines,
  BarChart3,
  BrainCircuit,
  CircleAlert,
  ClipboardCheck,
  FileText,
  Gauge,
  Hourglass,
  PhoneCall,
} from "lucide-react";
import { ReportRangePicker } from "@/components/report-range-picker";
import { requireProfile } from "@/lib/auth";
import { fetchQualityAnalysis } from "@/lib/quality-analysis";
import { resolveReportRange } from "@/lib/report-range";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isSecretariaVirtualAuditCampaign,
  SECRETARIA_VIRTUAL_RUBRIC_NAME,
  SECRETARIA_VIRTUAL_RUBRIC_VERSION,
} from "@/lib/secretaria-virtual-quality-rubric";
import { Avatar, Badge, Callout, EmptyState, SectionCard, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDay(value: string) {
  return new Date(value)
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
    .replace(".", "");
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Santiago",
  });
}

function formatScore(value: number) {
  return value.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}

const STATUS = {
  pending: { label: "Pendiente", tone: "neutral" as const },
  processing: { label: "Procesando", tone: "info" as const },
  completed: { label: "Completada", tone: "success" as const },
  failed: { label: "Con error", tone: "danger" as const },
};

/** Color de la barra de puntaje según el veredicto. */
const SCORE_BAR = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground/40",
} as const;

const EVALUATION_VERDICT = {
  cumple: { label: "Cumple", tone: "success" as const },
  parcial: { label: "Parcial", tone: "warning" as const },
  no_cumple: { label: "No cumple", tone: "danger" as const },
  no_evaluable: { label: "No evaluable", tone: "neutral" as const },
};

export default async function CalidadAnalisisPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const params = await searchParams;
  const range = resolveReportRange(params);
  const supabase = await createClient();
  const analysis = await fetchQualityAnalysis(supabase, createAdminClient(), range.from, range.to);
  const completionRate =
    analysis.summary.eligibleRecordings > 0
      ? (analysis.summary.completed / analysis.summary.eligibleRecordings) * 100
      : 0;
  const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const mercuryConfigured = Boolean(process.env.INCEPTION_API_KEY?.trim());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
            <span className="icon-chip size-7 rounded-lg" data-tone="violet" aria-hidden="true">
              <BarChart3 size={14} />
            </span>
            Reportes y análisis
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cobertura de transcripción y preparación de evaluaciones automáticas.
          </p>
        </div>
        <ReportRangePicker />
      </div>

      {range.notice && <Callout tone="warning">{range.notice}</Callout>}
      {analysis.error && <Callout tone="danger">{analysis.error}</Callout>}
      {!groqConfigured && (
        <Callout tone="warning">
          Falta configurar <code>GROQ_API_KEY</code>. La interfaz está lista, pero no enviará audios hasta cargar el secreto.
        </Callout>
      )}

      <KpiStrip title="Transcripción" meta="Venta o rechazo de más de 2 minutos">
        <KpiStripItem
          label="Llamadas seleccionadas"
          value={analysis.summary.eligibleRecordings.toLocaleString("es-CL")}
          icon={PhoneCall}
          detail="Entran solas a la cola de transcripción"
        />
        <KpiStripItem
          label="Transcritas"
          value={analysis.summary.completed.toLocaleString("es-CL")}
          icon={FileText}
          tone={analysis.summary.completed > 0 ? "good" : "default"}
          detail={`${completionRate.toLocaleString("es-CL", { maximumFractionDigits: 1 })}% de cobertura`}
          progress={completionRate}
        />
        <KpiStripItem
          label="Pendientes"
          value={analysis.summary.pending.toLocaleString("es-CL")}
          icon={Hourglass}
          tone={analysis.summary.pending > 0 ? "warn" : "default"}
        />
        <KpiStripItem
          label="Con error"
          value={analysis.summary.failed.toLocaleString("es-CL")}
          icon={CircleAlert}
          tone={analysis.summary.failed ? "danger" : "default"}
        />
        <KpiStripItem
          label="Audio transcrito"
          value={formatDuration(analysis.summary.transcribedSeconds)}
          icon={AudioLines}
        />
      </KpiStrip>

      <Callout tone={mercuryConfigured ? "info" : "warning"}>
        <span className="flex items-start gap-3">
          <span className="icon-chip size-7 rounded-lg" data-tone={mercuryConfigured ? "violet" : "amber"} aria-hidden="true">
            <BrainCircuit size={14} />
          </span>
          <span>
            {mercuryConfigured
              ? `${SECRETARIA_VIRTUAL_RUBRIC_NAME} · pauta v${SECRETARIA_VIRTUAL_RUBRIC_VERSION} activa. Los puntajes de Mercury 2 son apoyo para revisión humana, no una decisión disciplinaria automática.`
              : `${SECRETARIA_VIRTUAL_RUBRIC_NAME} · pauta v${SECRETARIA_VIRTUAL_RUBRIC_VERSION} lista. Falta configurar una clave nueva como INCEPTION_API_KEY para ejecutar auditorías.`}
          </span>
        </span>
      </Callout>

      <KpiStrip
        title="Auditoría · Secretaría Virtual"
        meta="Solo outbound transcritas; Secretaría Virtual - Inbound queda fuera de esta pauta"
      >
        <KpiStripItem
          label="Auditables"
          value={analysis.summary.auditableRecordings.toLocaleString("es-CL")}
          icon={FileText}
          detail="Transcritas con pauta aplicable"
        />
        <KpiStripItem
          label="Auditadas"
          value={analysis.summary.evaluated.toLocaleString("es-CL")}
          icon={ClipboardCheck}
          tone={analysis.summary.evaluated > 0 ? "good" : "default"}
          progress={
            analysis.summary.auditableRecordings > 0
              ? (analysis.summary.evaluated / analysis.summary.auditableRecordings) * 100
              : undefined
          }
        />
        <KpiStripItem
          label="Pendientes"
          value={analysis.summary.evaluationPending.toLocaleString("es-CL")}
          icon={Hourglass}
          tone={analysis.summary.evaluationPending > 0 ? "warn" : "default"}
          detail={analysis.summary.evaluationProcessing ? `${analysis.summary.evaluationProcessing} procesando` : undefined}
        />
        <KpiStripItem
          label="Puntaje promedio"
          value={analysis.summary.evaluated ? `${formatScore(analysis.summary.averageScore)}/100` : "—"}
          icon={Gauge}
          progress={analysis.summary.evaluated ? analysis.summary.averageScore : undefined}
        />
        <KpiStripItem
          label="Con error"
          value={analysis.summary.evaluationFailed.toLocaleString("es-CL")}
          icon={CircleAlert}
          tone={analysis.summary.evaluationFailed ? "danger" : "default"}
        />
      </KpiStrip>

      <SectionCard
        title="Actividad reciente"
        description="Últimas transcripciones dentro del período seleccionado."
      >
        {analysis.recent.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Todavía no hay transcripciones en este período."
            description="Amplía el rango de fechas o transcribe una llamada desde Grabaciones."
          />
        ) : (
          <Table>
            <Thead>
              <Th>Ejecutivo</Th>
              <Th>Llamada</Th>
              <Th>Transcripción</Th>
              <Th>Auditoría</Th>
              <Th align="right">Caracteres</Th>
            </Thead>
            <Tbody>
              {analysis.recent.map((row) => {
                const status = STATUS[row.status];
                const evaluationVerdict = row.evaluationVerdict
                  ? EVALUATION_VERDICT[row.evaluationVerdict]
                  : null;
                return (
                  <Tr key={row.recordingId}>
                    <Td>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={row.agentName} size="md" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{row.agentName}</span>
                          <span className="block truncate text-xs text-muted-foreground">{row.campaignName}</span>
                        </span>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="block text-foreground">{formatDay(row.recordingStartedAt)}</span>
                      <span className="block text-xs text-muted-foreground">{formatTime(row.recordingStartedAt)}</span>
                    </Td>
                    <Td>
                      <span className="block">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                      {row.languageCode && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">Idioma: {row.languageCode}</span>
                      )}
                    </Td>
                    <Td className="min-w-44">
                      {evaluationVerdict && row.evaluationScore !== null ? (
                        <span className="block">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-semibold tabular-nums text-foreground">
                              {formatScore(row.evaluationScore)}
                              <span className="text-[11px] font-normal text-muted-foreground">/100</span>
                            </span>
                            <Badge tone={evaluationVerdict.tone}>{evaluationVerdict.label}</Badge>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                            <span
                              className={`block h-full rounded-full ${SCORE_BAR[evaluationVerdict.tone]}`}
                              style={{ width: `${Math.min(100, Math.max(0, row.evaluationScore))}%` }}
                            />
                          </span>
                        </span>
                      ) : row.evaluationStatus === "processing" ? (
                        <Badge tone="info">Auditando</Badge>
                      ) : row.evaluationStatus === "failed" ? (
                        <Badge tone="danger">Con error</Badge>
                      ) : isSecretariaVirtualAuditCampaign(row.campaignName) && row.status === "completed" ? (
                        <Badge tone="neutral">Pendiente</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td align="right" muted>{row.transcriptCharacters.toLocaleString("es-CL")}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
