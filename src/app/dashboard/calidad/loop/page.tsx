import Link from "next/link";
import { ArrowLeft, BrainCircuit, ChevronRight, ClipboardCheck, ExternalLink, Layers, MessageSquareQuote, Quote } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LOOP_ACTION_LABELS, type ConversationFacts, type LoopDecision } from "@/lib/ai-learning-loop";
import { LearningLoopConfig, LearningLoopReview } from "@/components/learning-loop-review";
import { RecordingAudioPlayer } from "@/components/recording-audio-player";
// Solo primitivos que tests/ai-learning-loop-render.test.ts simula: esta página
// se renderiza en la prueba con un `@/components/ui` acotado y sin report-kit,
// así que la franja de cifras y el estado vacío se arman acá con marcado plano.
import { Badge, Button, Callout, Field, SectionCard, Select, buttonClasses } from "@/components/ui";

type Feedback = { id: string; kind: string; created_at: string; payload: Record<string, unknown> };
type Run = {
  id: string; lead_id: string; recording_id: string; status: string; source_hash: string;
  policy_version: string; created_at: string; expires_at: string; superseded_at: string | null;
  analysis: ConversationFacts | null; decision: LoopDecision | null; review_version: number;
  review: { recommendation: string; extraction: string; note: string } | null;
  error_code: string | null;
};
const STATUS: Record<string, string> = { pending: "Pendiente", processing: "Procesando", completed: "Analizado", failed: "Falló", superseded: "Reemplazado" };
/** "24 may · 09:27" en hora de Chile. */
function date(value: string) {
  const parsed = new Date(value);
  const day = parsed.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" }).replace(".", "");
  const time = parsed.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" });
  return `${day} · ${time}`;
}
/** Franja de cifras con el aspecto de `KpiStrip` (una tarjeta dividida). */
function Franja({ items }: { items: { label: string; value: number; icon: typeof Layers; good?: boolean }[] }) {
  return <section className="atlas-panel grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm sm:grid-cols-3">
    {items.map(({ label, value, icon: Icon, good }) => <div key={label} className="bg-surface px-5 py-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon size={14} aria-hidden="true" />{label}</p>
      <p className={`mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums ${good && value > 0 ? "text-success" : "text-foreground"}`}>{value.toLocaleString("es-CL")}</p>
    </div>)}
  </section>;
}
const FEEDBACK_KIND: Record<string, string> = { human_review: "Revisión humana", source_revision: "Corrección de la gestión fuente" };

export default async function LearningLoopPage({ searchParams }: { searchParams: Promise<{ campaign?: string; page?: string; run?: string }> }) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const params = await searchParams;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const campaignId = params.campaign && uuid.test(params.campaign) ? params.campaign : null;
  const page = Math.min(1000, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  const selectedRun = params.run && uuid.test(params.run) ? params.run : null;
  const supabase = await createClient();
  const campaignsResult = await supabase.rpc("get_report_scope_campaigns");
  const campaigns = (campaignsResult.data ?? []) as Array<{ id: string; name: string }>;
  let query = supabase.from("ai_loop_runs")
    .select("id,lead_id,recording_id,status,source_hash,policy_version,created_at,expires_at,superseded_at,analysis,decision,review_version,review,error_code", { count: "exact" })
    .order("created_at", { ascending: false }).order("id").range((page - 1) * 20, page * 20 - 1);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (selectedRun) query = query.eq("id", selectedRun).range(0, 0);
  const [runsResult, configResult] = await Promise.all([
    query,
    campaignId ? supabase.from("ai_loop_campaign_configs").select("mode,daily_attempt_limit,attempts_today,quota_day").eq("campaign_id", campaignId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const runs = (runsResult.data ?? []) as Run[];
  const activeRun = selectedRun ? runs.find((run) => run.id === selectedRun) : null;
  const feedbackResult = activeRun ? await supabase.from("ai_loop_feedback").select("id,kind,created_at,payload").eq("run_id", activeRun.id).order("created_at", { ascending: false }).limit(30) : { data: [], error: null };
  const transcriptResult = activeRun ? await supabase.from("call_transcriptions").select("status,transcript_text").eq("recording_id", activeRun.recording_id).maybeSingle() : { data: null, error: null };
  const feedback = (feedbackResult.data ?? []) as Feedback[];
  // Request-time display only in an async server component. The review RPC
  // independently enforces expiry using the database clock on every write.
  // eslint-disable-next-line react-hooks/purity
  const asOf = Date.now();
  const error = campaignsResult.error || runsResult.error || configResult.error || feedbackResult.error || transcriptResult.error;
  if (error) console.error("[calidad/loop] consulta:", error.message);
  const url = (nextPage: number, run?: string) => `/dashboard/calidad/loop?${new URLSearchParams({ page: String(nextPage), ...(campaignId ? { campaign: campaignId } : {}), ...(run ? { run } : {}) })}`;
  return <div className="space-y-5">
    <Callout tone="info">Observación posterior a la llamada. Las decisiones no llaman, envían mensajes, agendan ni cambian prioridades. Los resultados posteriores son observaciones, no prueba de mejora causal.</Callout>
    {process.env.AI_LOOP_ENABLED !== "true" && <Callout tone="warning">El procesamiento IA está apagado en el servidor. Puedes consultar resultados existentes; no se generarán nuevos análisis.</Callout>}
    {error && <Callout tone="danger">No se pudieron cargar todos los análisis, así que no mostramos totales a medias. Vuelve a cargar la página; si sigue igual, avisa a un administrador.</Callout>}
    <form className="atlas-panel flex flex-wrap items-end gap-2.5 rounded-xl border border-border bg-surface p-3 shadow-sm">
      <Field label="Campaña" hideLabel className="w-72"><Select name="campaign" defaultValue={campaignId ?? ""}><option value="">Todas las campañas autorizadas</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>
      <Button type="submit" variant="secondary" className="ml-auto">Filtrar</Button>
    </form>
    {selectedRun && <Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" href={url(1)}><ArrowLeft size={14} aria-hidden="true" />Volver al listado</Link>}
    {profile.role === "admin" && campaignId && !configResult.error && <SectionCard title="Configuración del piloto" description="Modo y cupo diario del análisis IA para esta campaña.">
      <div className="border-t border-border px-5 py-4">
        <LearningLoopConfig key={`${campaignId}:${configResult.data?.mode}`} campaignId={campaignId} mode={configResult.data?.mode ?? "off"} dailyLimit={configResult.data?.daily_attempt_limit ?? 20} />
      </div>
    </SectionCard>}
    {!error && <>
      <Franja items={[
        { label: "Versiones en el alcance", value: runsResult.count ?? 0, icon: Layers },
        { label: "Analizadas en esta página", value: runs.filter((run) => run.status === "completed").length, icon: BrainCircuit },
        { label: "Revisadas en esta página", value: runs.filter((run) => run.review_version > 0).length, icon: ClipboardCheck, good: true },
      ]} />
      <SectionCard title="Decisiones del loop" description="Cada análisis propone una acción con su evidencia; la revisión humana decide si sirve.">
        {runs.length === 0 ? <div className="flex flex-col items-center gap-2 border-t border-border px-5 py-12 text-center">
          <BrainCircuit size={22} className="mb-1 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No hay análisis en este alcance.</p>
          <p className="max-w-sm text-xs text-muted-foreground">Se requiere una campaña en observación, transcripciones completadas y gestión final. No se transcriben audios automáticamente desde este loop.</p>
        </div> :
        <ol className="divide-y divide-border/70 border-t border-border">
          {runs.map((run) => {
            const stale = !!run.superseded_at || Date.parse(run.expires_at) <= asOf;
            const active = activeRun?.id === run.id;
            return <li key={run.id}>
              <div className="flex items-start gap-3 px-5 py-4">
                <span className="icon-chip size-9 rounded-lg" data-tone={stale ? "slate" : "violet"} aria-hidden="true"><BrainCircuit size={17} /></span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground">{run.decision ? LOOP_ACTION_LABELS[run.decision.action] : STATUS[run.status]}</span>
                    <Badge tone={stale ? "neutral" : "info"}>{stale ? "No vigente" : STATUS[run.status]}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{date(run.created_at)} · Política {run.policy_version} · Revisión {run.review_version}</p>
                  {run.decision && <p className="text-sm leading-relaxed text-foreground">{run.decision.reason}</p>}
                  {run.review && <p className="text-xs text-muted-foreground">Última revisión: {run.review.recommendation === "accepted" ? "aceptada" : "rechazada"}; hechos {run.review.extraction === "confirmed" ? "confirmados" : run.review.extraction === "rejected" ? "rechazados" : "no confirmados"}.</p>}
                  {run.error_code && <p className="text-xs text-warning" title={`Código: ${run.error_code}`}>Este análisis no pudo completarse. Atlas lo reintenta solo, hasta tres veces y dentro del cupo diario; no tienes que hacer nada.</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                  <Link className={buttonClasses({ variant: "ghost", size: "sm" })} href={`/dashboard/leads/${run.lead_id}`}>Ficha 360<ExternalLink size={13} aria-hidden="true" /></Link>
                  {!active && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={url(page, run.id)}>Ver evidencia y revisión<ChevronRight size={14} aria-hidden="true" /></Link>}
                </div>
              </div>
              {active && <div className="space-y-6 border-t border-border bg-surface-raised px-5 py-5">
                <p className="break-all font-mono text-[11px] text-muted-foreground">Decisión {run.id} · Fuente {run.source_hash}</p>
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-foreground">Comprobar la fuente original</h3>
                  <div className="rounded-xl border border-border bg-surface p-3"><RecordingAudioPlayer recordingId={run.recording_id} playable /></div>
                  {transcriptResult.data?.status === "completed" && <details className="text-sm"><summary className="cursor-pointer font-medium text-primary">Ver transcripción actual</summary>
                    <p className="mt-2 text-xs text-muted-foreground">La transcripción actual puede diferir de versiones históricas. Confirma hablantes y contexto escuchando el audio.</p>
                    <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 leading-6">{transcriptResult.data.transcript_text}</p>
                  </details>}
                </section>
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-foreground">Hechos candidatos y evidencia literal</h3>
                  {run.analysis?.facts.length ? <ul className="space-y-2">{run.analysis.facts.map((fact, index) => <li key={index} className="flex gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                    <Quote size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 text-sm"><p className="text-foreground">{fact.quote}</p><p className="mt-1 text-xs text-muted-foreground">{fact.kind} · {fact.speaker === "customer" ? "cliente inferido" : fact.speaker === "agent" ? "agente inferido" : "hablante incierto"}{fact.requested_time_text ? ` · Referencia temporal: ${fact.requested_time_text}` : ""}</p></div>
                  </li>)}</ul> : <p className="text-sm text-muted-foreground">No se extrajeron hechos respaldados.</p>}
                  <p className="text-xs text-muted-foreground">Memorias previas utilizadas: {run.decision?.memory_ids.length ?? 0}. Las citas prueban procedencia; la interpretación requiere revisión. Puedes retirar hechos incorrectos desde la ficha 360, aunque su decisión haya vencido.</p>
                </section>
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-foreground">Tu revisión</h3>
                  {!stale && run.status === "completed" ? <div className="rounded-xl border border-border bg-surface p-4"><LearningLoopReview runId={run.id} version={run.review_version} /></div> : <Callout>Esta versión no admite revisión operativa. Se conserva como historia.</Callout>}
                </section>
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-foreground">Feedback y resultados observados <span className="font-normal text-muted-foreground">· últimos 30 eventos</span></h3>
                  {feedback.length ? <ol className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-surface">{feedback.map((item) => <li key={item.id} className="flex gap-3 px-4 py-3 text-sm">
                    <span className="icon-chip size-7 rounded-lg" data-tone={item.kind === "human_review" ? "violet" : "slate"} aria-hidden="true"><MessageSquareQuote size={14} /></span>
                    <div className="min-w-0"><p className="font-medium text-foreground">{FEEDBACK_KIND[item.kind] ?? "Gestión posterior observada"} <span className="font-normal text-muted-foreground">· {date(item.created_at)}</span></p><p className="mt-0.5 text-muted-foreground">{item.kind === "human_review" ? String(item.payload.note ?? "") : [item.payload.status, item.payload.outcome, item.payload.reason].filter(Boolean).map(String).join(" · ") || "Resultado retirado o aún no definido"}</p></div>
                  </li>)}</ol> : <p className="text-sm text-muted-foreground">Aún no hay feedback ni resultados posteriores disponibles.</p>}
                </section>
              </div>}
            </li>;
          })}
        </ol>}
      </SectionCard>
      <nav aria-label="Páginas del loop" className="flex gap-2 text-sm">{page > 1 && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={url(page - 1)}>Anterior</Link>}{(runsResult.count ?? 0) > page * 20 && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={url(page + 1)}>Siguiente</Link>}</nav>
    </>}
  </div>;
}
