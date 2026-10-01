"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, Lightbulb, ListChecks, LoaderCircle, RotateCcw, ThumbsUp, TriangleAlert } from "lucide-react";
import { Badge, Button, Callout, EmptyState, SlideOver, useToast } from "@/components/ui";
import { isSecretariaVirtualAuditCampaign } from "@/lib/secretaria-virtual-quality-rubric";

export type QualityEvaluationStatus = "pending" | "processing" | "completed" | "failed";
export type QualityEvaluationVerdict = "cumple" | "parcial" | "no_cumple" | "no_evaluable";

type Evidence = { quote?: string; start_seconds?: number; end_seconds?: number };
type Criterion = {
  id?: string;
  name?: string;
  status?: "cumple" | "parcial" | "no_cumple" | "no_aplica" | "no_observable";
  score?: number;
  maxScore?: number;
  finding?: string;
  evidence?: Evidence[];
};
type RiskFlag = {
  type?: string;
  severity?: "baja" | "media" | "alta";
  description?: string;
  evidence_quote?: string;
};
type EvaluationPayload = {
  status?: QualityEvaluationStatus | "not_applicable";
  score?: number | null;
  verdict?: QualityEvaluationVerdict | null;
  speakerConfidence?: number | null;
  summary?: string | null;
  criteria?: Criterion[];
  strengths?: string[];
  improvements?: string[];
  riskFlags?: RiskFlag[];
  rubric?: { key?: string; version?: number; name?: string };
  error?: string;
  message?: string;
};

const VERDICT = {
  cumple: { label: "Cumple", tone: "success" as const },
  parcial: { label: "Cumplimiento parcial", tone: "warning" as const },
  no_cumple: { label: "No cumple", tone: "danger" as const },
  no_evaluable: { label: "No evaluable", tone: "neutral" as const },
};

/** Color de la barra de puntaje según el veredicto. */
const TONE_BAR: Record<"success" | "warning" | "danger" | "neutral" | "info", string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground/40",
  info: "bg-primary",
};

/** Barra de 0 a 100 que acompaña al puntaje, como en Gong o Chorus. */
function ScoreBar({ value, tone, className }: { value: number; tone: keyof typeof TONE_BAR; className?: string }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-surface-muted ${className ?? ""}`} aria-hidden="true">
      <span className={`block h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${width}%` }} />
    </span>
  );
}

const TONE_TEXT: Record<"success" | "warning" | "danger" | "neutral" | "info", string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-foreground",
  info: "text-primary",
};

/** Encabezado de bloque: ícono en chip tintado y título. */
function BlockTitle({ icon: Icon, tone, children }: { icon: typeof ListChecks; tone: string; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="icon-chip size-7 rounded-lg" data-tone={tone} aria-hidden="true">
        <Icon size={14} />
      </span>
      {children}
    </h3>
  );
}

const CRITERION_STATUS = {
  cumple: { label: "Cumple", tone: "success" as const },
  parcial: { label: "Parcial", tone: "warning" as const },
  no_cumple: { label: "No cumple", tone: "danger" as const },
  no_aplica: { label: "No aplica", tone: "neutral" as const },
  no_observable: { label: "No observable", tone: "neutral" as const },
};

function formatTimestamp(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function RecordingQualityEvaluationControl({
  recordingId,
  campaignName,
  playable,
  transcriptionStatus,
  eligible,
  initialStatus,
  initialScore,
  initialVerdict,
  compact = false,
}: {
  recordingId: string;
  campaignName: string;
  playable: boolean;
  transcriptionStatus: "pending" | "processing" | "completed" | "failed" | null;
  eligible: boolean;
  initialStatus: QualityEvaluationStatus | null;
  initialScore: number | null;
  initialVerdict: QualityEvaluationVerdict | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<QualityEvaluationStatus | null>(initialStatus);
  const [score, setScore] = useState<number | null>(initialScore);
  const [verdict, setVerdict] = useState<QualityEvaluationVerdict | null>(initialVerdict);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);
  const [transcriptionReady, setTranscriptionReady] = useState(transcriptionStatus === "completed");

  if (!isSecretariaVirtualAuditCampaign(campaignName)) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">Sin pauta</span>;
  }
  if (!playable) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">Sin audio</span>;
  }
  if (transcriptionStatus === "processing" && !transcriptionReady && status !== "completed") {
    return (
      <Badge tone="info" dot={false} className={compact ? "px-1.5 py-1" : undefined}>
        <LoaderCircle size={13} className="animate-spin text-primary" />
        Transcribiendo
      </Badge>
    );
  }

  const request = async (method: "GET" | "POST") => {
    const response = await fetch(
      `/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/evaluate`,
      {
        method,
        cache: "no-store",
        ...(method === "POST"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ overrideSelection: !eligible }),
            }
          : {}),
      }
    );
    const payload = (await response.json()) as EvaluationPayload;
    if (!response.ok) throw new Error(payload.error ?? payload.message ?? "No se pudo procesar la auditoría.");
    return payload;
  };

  const evaluate = async () => {
    setLoading(true);
    setStatus("processing");
    try {
      if (!transcriptionReady) {
        const transcriptionResponse = await fetch(
          `/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/transcribe`,
          {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overrideSelection: !eligible }),
          }
        );
        const transcriptionPayload = (await transcriptionResponse.json()) as {
          status?: string;
          error?: string;
          message?: string;
        };
        if (!transcriptionResponse.ok || transcriptionPayload.status !== "completed") {
          throw new Error(
            transcriptionPayload.error ??
              transcriptionPayload.message ??
              "No se pudo preparar la transcripción para evaluar el guion."
          );
        }
        setTranscriptionReady(true);
      }
      const payload = await request("POST");
      setStatus(payload.status === "not_applicable" ? null : payload.status ?? "completed");
      setScore(payload.score ?? null);
      setVerdict(payload.verdict ?? null);
      setEvaluation(payload);
      setOpen(true);
      toast({ tone: "success", message: "Llamada auditada contra la pauta vigente." });
      router.refresh();
    } catch (error) {
      setStatus(initialStatus === "completed" ? "completed" : "failed");
      toast({
        tone: "danger",
        message: error instanceof Error ? error.message : "No se pudo auditar la llamada.",
      });
    } finally {
      setLoading(false);
    }
  };

  const view = async () => {
    setOpen(true);
    if (evaluation?.summary) return;
    setLoading(true);
    try {
      const payload = await request("GET");
      setStatus(payload.status === "not_applicable" ? null : payload.status ?? status);
      setScore(payload.score ?? score);
      setVerdict(payload.verdict ?? verdict);
      setEvaluation(payload);
    } catch (error) {
      setOpen(false);
      toast({
        tone: "danger",
        message: error instanceof Error ? error.message : "No se pudo cargar la auditoría.",
      });
    } finally {
      setLoading(false);
    }
  };

  const verdictMeta = verdict ? VERDICT[verdict] : null;

  return (
    <>
      {status === "completed" ? (
        <button
          type="button"
          onClick={view}
          disabled={loading}
          title="Ver la auditoría de la llamada"
          className="group/score block w-full min-w-0 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-0.5">
              {loading ? (
                <LoaderCircle size={14} className="animate-spin self-center text-muted-foreground" aria-hidden="true" />
              ) : score === null ? (
                <span className="text-xs font-medium text-primary">Ver auditoría</span>
              ) : (
                <>
                  <span className={`text-[15px] font-semibold tabular-nums ${TONE_TEXT[verdictMeta?.tone ?? "neutral"]}`}>
                    {score.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
                  </span>
                  <span className="text-[11px] text-muted-foreground">/100</span>
                </>
              )}
            </span>
            {verdictMeta && (
              <span className="truncate text-[11px] text-muted-foreground group-hover/score:text-foreground">
                {verdictMeta.label}
              </span>
            )}
          </span>
          {score !== null && <ScoreBar value={score} tone={verdictMeta?.tone ?? "info"} className="mt-1.5" />}
        </button>
      ) : status === "processing" || loading ? (
        <Badge tone="info" dot={false} className={compact ? "px-1.5 py-1" : undefined}>
          <LoaderCircle size={13} className="animate-spin text-primary" />
          Auditando
        </Badge>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={evaluate}
          className={compact ? "w-full gap-1 px-2 text-xs leading-tight" : undefined}
          title={
            transcriptionReady
              ? "Evalúa el apego al guion vigente"
              : "Transcribe la llamada y luego evalúa su apego al guion"
          }
        >
          {status === "failed" ? <RotateCcw size={14} /> : <BrainCircuit size={14} />}
          {status === "failed" ? "Reintentar" : "Evaluar script"}
        </Button>
      )}

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Auditoría de la llamada"
        description="Evaluación asistida por Mercury 2 contra el guion versionado de Secretaría Virtual."
        width="lg"
      >
        {loading && !evaluation?.summary ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle size={16} className="animate-spin" />
            Cargando auditoría…
          </div>
        ) : evaluation?.summary ? (
          <div className="space-y-6">
            <Callout tone="warning">
              Whisper no identifica hablantes. Mercury infiere los roles por contexto; usa este resultado como apoyo y revisa el audio antes de tomar decisiones sobre una persona.
            </Callout>

            <div className="rounded-xl border border-border bg-surface-raised p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Puntaje normalizado</p>
                  <p className={`mt-1 text-4xl font-semibold tracking-tight tabular-nums ${TONE_TEXT[verdictMeta?.tone ?? "neutral"]}`}>
                    {evaluation.score?.toLocaleString("es-CL", { maximumFractionDigits: 1 }) ?? "—"}
                    <span className="text-base font-normal text-muted-foreground">/100</span>
                  </p>
                </div>
                {verdictMeta && <Badge tone={verdictMeta.tone}>{verdictMeta.label}</Badge>}
              </div>
              {typeof evaluation.score === "number" && (
                <ScoreBar value={evaluation.score} tone={verdictMeta?.tone ?? "info"} className="mt-3 h-2" />
              )}
              {(evaluation.rubric?.version ||
                (evaluation.speakerConfidence !== null && evaluation.speakerConfidence !== undefined)) && (
                <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {evaluation.rubric?.version && <span>Pauta v{evaluation.rubric.version}</span>}
                  {evaluation.speakerConfidence !== null && evaluation.speakerConfidence !== undefined && (
                    <span>Confianza de roles {Math.round(evaluation.speakerConfidence * 100)}%</span>
                  )}
                </p>
              )}
            </div>

            <div>
              <BlockTitle icon={BrainCircuit} tone="violet">Resumen</BlockTitle>
              <p className="mt-2 text-sm leading-6 text-foreground">{evaluation.summary}</p>
            </div>

            <div className="space-y-3">
              <BlockTitle icon={ListChecks} tone="violet">Criterios</BlockTitle>
              <ol className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border">
                {(evaluation.criteria ?? []).map((criterion) => {
                  const meta = criterion.status ? CRITERION_STATUS[criterion.status] : null;
                  const scored = criterion.status !== "no_aplica" && criterion.status !== "no_observable";
                  const max = criterion.maxScore ?? 0;
                  return (
                    <li key={criterion.id ?? criterion.name} className="bg-surface px-4 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{criterion.name ?? criterion.id}</p>
                        <div className="flex items-center gap-3">
                          {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
                          {scored && (
                            <span className="text-xs font-medium tabular-nums text-foreground">
                              {criterion.score ?? 0}
                              <span className="text-muted-foreground">/{max}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      {scored && max > 0 && (
                        <ScoreBar value={((criterion.score ?? 0) / max) * 100} tone={meta?.tone ?? "neutral"} className="mt-2 h-1" />
                      )}
                      {criterion.finding && <p className="mt-2 text-sm leading-5 text-muted-foreground">{criterion.finding}</p>}
                      {(criterion.evidence ?? []).filter((item) => item.quote).map((item, index) => {
                        const timestamp = formatTimestamp(item.start_seconds);
                        return (
                          <blockquote
                            key={`${criterion.id}-${index}`}
                            className="mt-2 flex gap-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs italic text-foreground"
                          >
                            {timestamp && <span className="shrink-0 not-italic tabular-nums text-muted-foreground">{timestamp}</span>}
                            <span>“{item.quote}”</span>
                          </blockquote>
                        );
                      })}
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <BlockTitle icon={ThumbsUp} tone="green">Fortalezas</BlockTitle>
                <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                  {(evaluation.strengths ?? []).map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4">
                <BlockTitle icon={Lightbulb} tone="amber">Oportunidades de mejora</BlockTitle>
                <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                  {(evaluation.improvements ?? []).map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {(evaluation.riskFlags ?? []).length > 0 && (
              <div>
                <BlockTitle icon={TriangleAlert} tone="rose">Alertas para revisión</BlockTitle>
                <div className="mt-2 space-y-2">
                  {(evaluation.riskFlags ?? []).map((risk, index) => (
                    <Callout key={`${risk.type}-${index}`} tone={risk.severity === "alta" ? "danger" : "warning"}>
                      <span className="font-medium">{risk.type}</span>
                      {risk.description ? `: ${risk.description}` : ""}
                      {risk.evidence_quote ? ` — “${risk.evidence_quote}”` : ""}
                    </Callout>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon={BrainCircuit} title="La auditoría todavía no está disponible." />
        )}
      </SlideOver>
    </>
  );
}
