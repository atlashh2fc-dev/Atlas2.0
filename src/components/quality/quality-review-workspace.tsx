"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BrainCircuit,
  CircleCheck,
  FileText,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { saveQualityReview } from "@/app/actions/calidad";
import { RecordingAudioPlayer, RECORDING_TIME_EVENT, seekRecording } from "@/components/recording-audio-player";
import { Avatar, Badge, Button, Callout, EmptyState, Select, buttonClasses, useToast } from "@/components/ui";
import {
  ACTION_LABEL,
  CALL_VALIDITIES,
  CALL_VALIDITY_LABEL,
  CRITERION_STATUS_LABEL,
  CRITERION_STATUS_TONE,
  CRITERION_STATUSES,
  DEFAULT_SCALE,
  QUALITY_ACTIONS,
  scorePauta,
  VERDICT_LABEL,
  VERDICT_TONE,
  type AiCriterionStatus,
  type CallValidity,
  type CriterionStatus,
  type PautaRubric,
  type PautaScale,
  type QualityAction,
  type QualityVerdict,
} from "@/lib/quality-pauta";
import { cn } from "@/lib/utils";

type Evidence = { quote?: string; start_seconds?: number; end_seconds?: number };

export type ReviewEvaluation = {
  status: "pending" | "processing" | "completed" | "failed";
  score: number | null;
  verdict: QualityVerdict | null;
  invalidReason: Exclude<CallValidity, "valida"> | null;
  speakerConfidence: number | null;
  summary: string | null;
  criteria: { id: string; name: string; weight?: number; status: AiCriterionStatus; finding?: string; evidence?: Evidence[] }[];
  strengths: string[];
  improvements: string[];
  riskFlags: { type?: string; severity?: "baja" | "media" | "alta"; description?: string; evidence_quote?: string }[];
  rubricKey: string;
  rubricName: string;
  completedAt: string | null;
};

export type ReviewRecord = {
  rubric_key: string;
  call_validity: CallValidity;
  criteria: { id: string; status: CriterionStatus; comment?: string | null }[];
  overall_score: number | string | null;
  verdict: QualityVerdict;
  action: QualityAction;
  comment: string | null;
  updated_at: string;
};

type Segment = { start?: number; end?: number; text?: string };

const SHORT_STATUS: Record<CriterionStatus, string> = {
  cumple: "Cumple",
  parcial: "Con obs.",
  no_cumple: "No cumple",
  no_aplica: "No aplica",
};

const ACTIVE_STATUS: Record<CriterionStatus, string> = {
  cumple: "border-success bg-success/10 text-success",
  parcial: "border-warning bg-warning/10 text-warning",
  no_cumple: "border-danger bg-danger/10 text-danger",
  no_aplica: "border-foreground/30 bg-surface-muted text-foreground",
};

function clock(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Santiago" })} · ${date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" })}`;
}

function sentenceCase(value: string) {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

const score = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString("es-CL", { maximumFractionDigits: 1 });

/** Cita con su minuto: un clic lleva el audio a ese momento. */
function Quote({ recordingId, evidence }: { recordingId: string; evidence: Evidence }) {
  const time = clock(evidence.start_seconds);
  return (
    <blockquote className="mt-2 flex gap-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs italic text-foreground">
      {time && (
        <button
          type="button"
          onClick={() => seekRecording(recordingId, evidence.start_seconds ?? 0)}
          className="shrink-0 rounded px-1 not-italic tabular-nums text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Escuchar desde aquí"
        >
          {time}
        </button>
      )}
      <span>“{evidence.quote}”</span>
    </blockquote>
  );
}

function Transcript({ recordingId, segments, text }: { recordingId: string; segments: Segment[]; text: string | null }) {
  const [current, setCurrent] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const onTime = (event: Event) => {
      const detail = (event as CustomEvent<{ recordingId: string; seconds: number }>).detail;
      if (detail?.recordingId === recordingId) setCurrent(detail.seconds);
    };
    window.addEventListener(RECORDING_TIME_EVENT, onTime);
    return () => window.removeEventListener(RECORDING_TIME_EVENT, onTime);
  }, [recordingId]);

  const usable = segments.filter((segment) => segment.text?.trim());
  if (usable.length === 0) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{text}</p>;
  }
  const activeIndex =
    current === null ? -1 : usable.findIndex((segment) => (segment.start ?? 0) <= current && current < (segment.end ?? Infinity));
  return (
    <ol ref={listRef} className="space-y-0.5">
      {usable.map((segment, index) => (
        <li key={`${segment.start}-${index}`}>
          <button
            type="button"
            onClick={() => seekRecording(recordingId, segment.start ?? 0)}
            className={cn(
              "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm leading-6 transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              index === activeIndex && "bg-primary/10",
            )}
          >
            <span className="w-10 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">{clock(segment.start) ?? ""}</span>
            <span className="text-foreground">{segment.text?.trim()}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function QualityReviewWorkspace({
  recordingId,
  playable,
  call,
  transcription,
  evaluation,
  review,
  rubricOptions,
  defaultRubricKey,
  scale,
  objective,
  hasPauta,
  canValidate,
  nextHref,
}: {
  recordingId: string;
  playable: boolean;
  call: {
    agentName: string;
    leadName: string;
    rut: string | null;
    campaignName: string;
    typification: string | null;
    startedAt: string;
    durationSeconds: number | null;
  };
  transcription: { status: string; text: string | null; segments: Segment[] } | null;
  evaluation: ReviewEvaluation | null;
  review: (ReviewRecord & { reviewerName: string | null }) | null;
  rubricOptions: { key: string; rubric: PautaRubric }[];
  defaultRubricKey: string;
  scale: PautaScale | null;
  objective: number;
  hasPauta: boolean;
  canValidate: boolean;
  nextHref: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, startSaving] = useTransition();
  const [running, setRunning] = useState<null | "evaluate" | "transcribe">(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rubricKey, setRubricKey] = useState(defaultRubricKey);
  const rubric = rubricOptions.find((option) => option.key === rubricKey)?.rubric ?? rubricOptions[0]?.rubric ?? null;
  const aiById = useMemo(
    () => new Map((evaluation?.status === "completed" ? evaluation.criteria : []).map((criterion) => [criterion.id, criterion])),
    [evaluation],
  );

  const initialStatuses = () => {
    const result: Record<string, CriterionStatus | undefined> = {};
    const reviewById = new Map((review?.criteria ?? []).map((criterion) => [criterion.id, criterion.status]));
    for (const criterion of rubric?.criteria ?? []) {
      const ai = aiById.get(criterion.id)?.status;
      result[criterion.id] = reviewById.get(criterion.id) ?? (ai && ai !== "no_observable" ? ai : undefined);
    }
    return result;
  };
  const [statuses, setStatuses] = useState<Record<string, CriterionStatus | undefined>>(initialStatuses);
  const [comments, setComments] = useState<Record<string, string>>(() =>
    Object.fromEntries((review?.criteria ?? []).map((criterion) => [criterion.id, criterion.comment ?? ""])),
  );
  const [validity, setValidity] = useState<CallValidity>(review?.call_validity ?? evaluation?.invalidReason ?? "valida");
  const [action, setAction] = useState<QualityAction>(review?.action ?? "sin_accion");
  const [comment, setComment] = useState(review?.comment ?? "");

  const preview = useMemo(() => {
    if (!rubric) return null;
    const results = rubric.criteria.flatMap((criterion) => {
      const status = statuses[criterion.id];
      return status ? [{ id: criterion.id, status }] : [];
    });
    return scorePauta(rubric, results, scale ?? DEFAULT_SCALE, validity);
  }, [rubric, statuses, scale, validity]);
  const missing = rubric ? rubric.criteria.filter((criterion) => !statuses[criterion.id]).length : 0;
  const changed = rubric
    ? rubric.criteria.filter((criterion) => {
        const ai = aiById.get(criterion.id)?.status;
        return ai && statuses[criterion.id] && ai !== statuses[criterion.id];
      }).length
    : 0;

  const runPipeline = async (kind: "evaluate" | "transcribe", force = false) => {
    setRunning(kind);
    setError(null);
    try {
      const response = await fetch(`/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/${kind}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "evaluate" ? { force } : { overrideSelection: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error ?? payload.message ?? "No se pudo completar.");
      toast({ tone: "success", message: kind === "evaluate" ? "Llamada evaluada con la pauta." : "Llamada transcrita." });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar.");
    } finally {
      setRunning(null);
    }
  };

  const save = () => {
    if (!rubric) return;
    setError(null);
    startSaving(async () => {
      const result = await saveQualityReview({
        recordingId,
        rubricKey,
        callValidity: validity,
        criteria: rubric.criteria.flatMap((criterion) => {
          const status = statuses[criterion.id];
          return status ? [{ id: criterion.id, status, comment: comments[criterion.id] ?? "" }] : [];
        }),
        action,
        comment,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      toast({ tone: "success", message: `Validación guardada · nota ${score(result.score)}` });
      router.refresh();
    });
  };

  const evaluationReady = evaluation?.status === "completed";
  const valid = validity === "valida";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Columna izquierda: la llamada, el audio, lo que vio la IA y la transcripción. */}
      <div className="min-w-0 space-y-4">
        <section className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Avatar name={call.agentName} size="md" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold text-foreground">{call.agentName}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDate(call.startedAt)} · {call.campaignName}
              </p>
            </div>
            {review ? <Badge tone="success">Validada</Badge> : evaluationReady ? <Badge tone="info">Por validar</Badge> : null}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Cliente</dt>
              <dd className="truncate text-foreground">{call.leadName}{call.rut ? ` · ${call.rut}` : ""}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Tipificación</dt>
              <dd className="truncate text-foreground">{call.typification ? sentenceCase(call.typification) : "Sin tipificación"}</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-border pt-4">
            <RecordingAudioPlayer recordingId={recordingId} playable={playable} />
          </div>
        </section>

        {evaluationReady && evaluation && (
          <section className="atlas-panel space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="icon-chip size-7 rounded-lg" data-tone="violet" aria-hidden="true"><BrainCircuit size={14} /></span>
                Lo que vio la IA
              </h3>
              <span className="text-xs text-muted-foreground">
                Nota IA <span className="font-semibold tabular-nums text-foreground">{score(evaluation.score)}</span>
                {evaluation.verdict ? ` · ${VERDICT_LABEL[evaluation.verdict]}` : ""}
                {evaluation.speakerConfidence !== null ? ` · roles ${Math.round(evaluation.speakerConfidence * 100)}%` : ""}
              </span>
            </div>
            {evaluation.summary && <p className="text-sm leading-6 text-foreground">{evaluation.summary}</p>}
            {(evaluation.riskFlags ?? []).length > 0 && (
              <div className="space-y-2">
                {evaluation.riskFlags.map((risk, index) => (
                  <Callout key={`${risk.type}-${index}`} tone={risk.severity === "alta" ? "danger" : "warning"}>
                    <span className="flex gap-2">
                      <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        <span className="font-medium">{risk.type}</span>
                        {risk.description ? `: ${risk.description}` : ""}
                        {risk.evidence_quote ? ` — “${risk.evidence_quote}”` : ""}
                      </span>
                    </span>
                  </Callout>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><ThumbsUp size={13} className="text-success" aria-hidden="true" />Fortalezas</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
                  {evaluation.strengths.map((item) => <li key={item}>· {item}</li>)}
                </ul>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Lightbulb size={13} className="text-warning" aria-hidden="true" />Para el feedback</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
                  {evaluation.improvements.map((item) => <li key={item}>· {item}</li>)}
                </ul>
              </div>
            </div>
          </section>
        )}

        <section className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={15} className="text-muted-foreground" aria-hidden="true" />
              Transcripción
            </h3>
            {transcription?.status === "completed" && <span className="text-xs text-muted-foreground">Toca una línea para escucharla</span>}
          </div>
          <div className="max-h-[560px] overflow-y-auto px-3 py-3">
            {transcription?.status === "completed" ? (
              <Transcript recordingId={recordingId} segments={transcription.segments} text={transcription.text} />
            ) : (
              <EmptyState
                icon={FileText}
                title={transcription?.status === "processing" ? "Transcribiendo…" : "Sin transcripción"}
                description={evaluationReady ? undefined : "Al evaluar con la pauta, Atlas transcribe la llamada primero."}
                action={
                  playable && transcription?.status !== "processing" ? (
                    <Button variant="secondary" onClick={() => runPipeline("transcribe")} disabled={running !== null}>
                      {running === "transcribe" ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
                      {running === "transcribe" ? "Transcribiendo…" : "Transcribir"}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        </section>
      </div>

      {/* Columna derecha: la validación. */}
      <div className="min-w-0">
        <section className="atlas-panel rounded-xl border border-border bg-surface shadow-sm lg:sticky lg:top-4">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{rubric?.name ?? "Pauta"} · objetivo {score(objective)}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className={cn("text-3xl font-semibold tracking-tight tabular-nums", preview?.score !== null && preview?.score !== undefined && preview.score >= objective ? "text-success" : "text-foreground")}>
                  {valid ? score(preview?.score) : "—"}
                </span>
                <span className="text-sm text-muted-foreground">/100</span>
                {preview && <Badge tone={VERDICT_TONE[preview.verdict]}>{VERDICT_LABEL[preview.verdict]}</Badge>}
              </p>
            </div>
            {preview && valid && (
              <p className="text-right text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-danger">{preview.criticalErrors}</span> críticos · {preview.nonCriticalErrors} con obs.
                {evaluationReady && <span className="block">{changed === 0 ? "Coincides con la IA" : `Corregiste ${changed} atributo${changed === 1 ? "" : "s"}`}</span>}
              </p>
            )}
          </header>

          {!hasPauta ? (
            <EmptyState icon={BrainCircuit} title="Esta campaña no tiene una pauta vigente" description="Asígnala desde Pautas para poder evaluarla." />
          ) : (
            <div className="space-y-5 px-5 py-4">
              {!evaluationReady && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    {evaluation?.status === "failed"
                      ? "La evaluación IA falló. Puedes reintentar o validar a mano."
                      : evaluation?.status === "processing"
                        ? "La IA está evaluando esta llamada…"
                        : "La IA aún no evalúa esta llamada. Puedes pedírselo o validar a mano."}
                  </p>
                  {playable && evaluation?.status !== "processing" && (
                    <Button variant="secondary" size="sm" onClick={() => runPipeline("evaluate")} disabled={running !== null}>
                      {running === "evaluate" ? <LoaderCircle size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
                      {running === "evaluate" ? "Evaluando…" : "Evaluar con IA"}
                    </Button>
                  )}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {rubricOptions.length > 1 && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-foreground">Rúbrica</span>
                    <Select
                      value={rubricKey}
                      onChange={(event) => {
                        setRubricKey(event.target.value);
                        setStatuses({});
                      }}
                    >
                      {rubricOptions.map((option) => (
                        <option key={option.key} value={option.key}>{option.rubric.name}</option>
                      ))}
                    </Select>
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-foreground">Llamada</span>
                  <Select value={validity} onChange={(event) => setValidity(event.target.value as CallValidity)}>
                    {CALL_VALIDITIES.map((item) => (
                      <option key={item} value={item}>{CALL_VALIDITY_LABEL[item]}</option>
                    ))}
                  </Select>
                </label>
              </div>

              {valid && rubric && (
                <ol className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border">
                  {rubric.criteria.map((criterion) => {
                    const ai = aiById.get(criterion.id);
                    const current = statuses[criterion.id];
                    const differs = ai && current && ai.status !== current;
                    return (
                      <li key={criterion.id} className={cn("bg-surface px-4 py-3.5", differs && "bg-warning/5")}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{criterion.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">Peso {score(criterion.weight)}</p>
                          </div>
                          {ai && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              IA
                              <Badge tone={CRITERION_STATUS_TONE[ai.status]}>{CRITERION_STATUS_LABEL[ai.status]}</Badge>
                            </span>
                          )}
                        </div>
                        {ai?.finding && <p className="mt-2 text-xs leading-5 text-muted-foreground">{ai.finding}</p>}
                        {(ai?.evidence ?? []).filter((item) => item.quote).map((item, index) => (
                          <Quote key={`${criterion.id}-${index}`} recordingId={recordingId} evidence={item} />
                        ))}
                        <div role="radiogroup" aria-label={`Resultado de ${criterion.name}`} className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          {CRITERION_STATUSES.map((status) => (
                            <button
                              key={status}
                              type="button"
                              role="radio"
                              aria-checked={current === status}
                              disabled={!canValidate}
                              onClick={() => {
                                setSaved(false);
                                setStatuses((previous) => ({ ...previous, [criterion.id]: status }));
                              }}
                              className={cn(
                                "h-9 rounded-lg border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                                current === status ? ACTIVE_STATUS[status] : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                              )}
                            >
                              {SHORT_STATUS[status]}
                            </button>
                          ))}
                        </div>
                        {(current === "parcial" || current === "no_cumple" || comments[criterion.id]) && (
                          <input
                            type="text"
                            value={comments[criterion.id] ?? ""}
                            onChange={(event) => setComments((previous) => ({ ...previous, [criterion.id]: event.target.value }))}
                            maxLength={600}
                            placeholder="Observación para el feedback (opcional)"
                            className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-foreground">Acción</span>
                  <Select value={action} onChange={(event) => setAction(event.target.value as QualityAction)}>
                    {QUALITY_ACTIONS.map((item) => (
                      <option key={item} value={item}>{ACTION_LABEL[item]}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[13px] font-medium text-foreground">Comentario de calidad</span>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="Lo que le dirías al ejecutivo en el feedback"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>

              {error && <Callout tone="danger">{error}</Callout>}

              {canValidate && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">
                    {review && !saved
                      ? `Validada${review.reviewerName ? ` por ${review.reviewerName}` : ""}. Puedes corregirla.`
                      : valid && missing > 0
                        ? `Faltan ${missing} atributo${missing === 1 ? "" : "s"} por marcar.`
                        : "La nota validada pasa a ser la oficial en los reportes."}
                  </p>
                  {saved && nextHref ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                        <CircleCheck size={15} aria-hidden="true" />
                        Guardada
                      </span>
                      <Link href={nextHref} className={buttonClasses()}>
                        Siguiente por validar
                        <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                    </span>
                  ) : (
                    <Button onClick={save} disabled={saving || !rubric || (valid && missing > 0)}>
                      {saving ? <LoaderCircle size={15} className="animate-spin" /> : <CircleCheck size={15} />}
                      {saving ? "Guardando…" : review ? "Guardar cambios" : "Guardar validación"}
                    </Button>
                  )}
                </div>
              )}

              {evaluationReady && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => runPipeline("evaluate", true)}
                    disabled={running !== null}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {running === "evaluate" ? <LoaderCircle size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Volver a evaluar con IA
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
