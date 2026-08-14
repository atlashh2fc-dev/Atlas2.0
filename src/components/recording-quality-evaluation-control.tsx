"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, LoaderCircle, RotateCcw } from "lucide-react";
import { Badge, Button, Callout, SlideOver, useToast } from "@/components/ui";
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
  transcriptionStatus,
  initialStatus,
  initialScore,
  initialVerdict,
}: {
  recordingId: string;
  campaignName: string;
  transcriptionStatus: "pending" | "processing" | "completed" | "failed" | null;
  initialStatus: QualityEvaluationStatus | null;
  initialScore: number | null;
  initialVerdict: QualityEvaluationVerdict | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<QualityEvaluationStatus | null>(initialStatus);
  const [score, setScore] = useState<number | null>(initialScore);
  const [verdict, setVerdict] = useState<QualityEvaluationVerdict | null>(initialVerdict);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);

  if (!isSecretariaVirtualAuditCampaign(campaignName)) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">Sin pauta</span>;
  }
  if (transcriptionStatus !== "completed") {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">Requiere texto</span>;
  }

  const request = async (method: "GET" | "POST") => {
    const response = await fetch(
      `/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/evaluate`,
      { method, cache: "no-store" }
    );
    const payload = (await response.json()) as EvaluationPayload;
    if (!response.ok) throw new Error(payload.error ?? payload.message ?? "No se pudo procesar la auditoría.");
    return payload;
  };

  const evaluate = async () => {
    setLoading(true);
    setStatus("processing");
    try {
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
        <Button type="button" variant="secondary" size="sm" onClick={view} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
          {score === null ? "Ver auditoría" : `${score.toLocaleString("es-CL", { maximumFractionDigits: 1 })}/100`}
        </Button>
      ) : status === "processing" || loading ? (
        <Badge tone="info">
          <LoaderCircle size={13} className="animate-spin" />
          Auditando
        </Badge>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={evaluate}>
          {status === "failed" ? <RotateCcw size={14} /> : <BrainCircuit size={14} />}
          {status === "failed" ? "Reintentar" : "Auditar"}
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

            <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface-muted/40 p-4">
              <div>
                <p className="text-xs text-muted-foreground">Puntaje normalizado</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
                  {evaluation.score?.toLocaleString("es-CL", { maximumFractionDigits: 1 }) ?? "—"}
                  <span className="text-base font-normal text-muted-foreground">/100</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {verdictMeta && <Badge tone={verdictMeta.tone}>{verdictMeta.label}</Badge>}
                {evaluation.rubric?.version && <Badge tone="neutral">Pauta v{evaluation.rubric.version}</Badge>}
                {evaluation.speakerConfidence !== null && evaluation.speakerConfidence !== undefined && (
                  <Badge tone="neutral">
                    Confianza de roles {Math.round(evaluation.speakerConfidence * 100)}%
                  </Badge>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">Resumen</h3>
              <p className="mt-2 text-sm leading-6 text-foreground">{evaluation.summary}</p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Criterios</h3>
              {(evaluation.criteria ?? []).map((criterion) => {
                const meta = criterion.status ? CRITERION_STATUS[criterion.status] : null;
                return (
                  <div key={criterion.id ?? criterion.name} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{criterion.name ?? criterion.id}</p>
                      <div className="flex items-center gap-2">
                        {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
                        {criterion.status !== "no_aplica" && criterion.status !== "no_observable" && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {criterion.score ?? 0}/{criterion.maxScore ?? 0}
                          </span>
                        )}
                      </div>
                    </div>
                    {criterion.finding && <p className="mt-2 text-sm leading-5 text-muted-foreground">{criterion.finding}</p>}
                    {(criterion.evidence ?? []).filter((item) => item.quote).map((item, index) => {
                      const timestamp = formatTimestamp(item.start_seconds);
                      return (
                        <blockquote key={`${criterion.id}-${index}`} className="mt-2 border-l-2 border-primary/40 pl-3 text-xs italic text-foreground">
                          {timestamp && <span className="mr-2 not-italic text-muted-foreground">{timestamp}</span>}
                          “{item.quote}”
                        </blockquote>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">Fortalezas</h3>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {(evaluation.strengths ?? []).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold text-foreground">Oportunidades de mejora</h3>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {(evaluation.improvements ?? []).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            </div>

            {(evaluation.riskFlags ?? []).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground">Alertas para revisión</h3>
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
          <p className="text-sm text-muted-foreground">La auditoría todavía no está disponible.</p>
        )}
      </SlideOver>
    </>
  );
}
