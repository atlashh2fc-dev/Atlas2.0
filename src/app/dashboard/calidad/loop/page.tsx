import Link from "next/link";
import { ArrowLeft, BrainCircuit, ClipboardCheck, Layers, Settings2 } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LOOP_ACTION_LABELS, type ConversationFacts, type LoopDecision } from "@/lib/ai-learning-loop";
import { LearningLoopConfig, LearningLoopReview } from "@/components/learning-loop-review";
import { RecordingAudioPlayer } from "@/components/recording-audio-player";
import { Badge, Callout, Field, MetricCard, SectionCard, Select, Button, buttonClasses } from "@/components/ui";

type Feedback = { id: string; kind: string; created_at: string; payload: Record<string, unknown> };
type Run = {
  id: string; lead_id: string; recording_id: string; status: string; source_hash: string;
  policy_version: string; created_at: string; expires_at: string; superseded_at: string | null;
  analysis: ConversationFacts | null; decision: LoopDecision | null; review_version: number;
  review: { recommendation: string; extraction: string; note: string } | null;
  error_code: string | null;
};
const STATUS: Record<string, string> = { pending: "Pendiente", processing: "Procesando", completed: "Analizado", failed: "Falló", superseded: "Reemplazado" };
function date(value: string) { return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value)); }

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
    <form className="flex flex-wrap items-end gap-3">
      <Field label="Campaña"><Select name="campaign" defaultValue={campaignId ?? ""}><option value="">Todas las autorizadas</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select></Field>
      <Button type="submit">Filtrar</Button>
    </form>
    {selectedRun && <Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" href={url(1)}><ArrowLeft size={14} aria-hidden="true" />Volver al listado</Link>}
    {profile.role === "admin" && campaignId && !configResult.error && <SectionCard title="Configuración del piloto" icon={Settings2} tone="slate">
      <div className="p-4">
        <LearningLoopConfig key={`${campaignId}:${configResult.data?.mode}`} campaignId={campaignId} mode={configResult.data?.mode ?? "off"} dailyLimit={configResult.data?.daily_attempt_limit ?? 20} />
      </div>
    </SectionCard>}
    {!error && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Versiones en el alcance" value={runsResult.count ?? 0} icon={Layers} iconTone="violet" />
        <MetricCard label="Analizadas en esta página" value={runs.filter((run) => run.status === "completed").length} icon={BrainCircuit} iconTone="violet" />
        <MetricCard label="Revisadas en esta página" value={runs.filter((run) => run.review_version > 0).length} icon={ClipboardCheck} iconTone="green" />
      </div>
      {runs.length === 0 && <Callout>No hay análisis en este alcance. Se requiere una campaña en observación, transcripciones completadas y gestión final. No se transcriben audios automáticamente desde este loop.</Callout>}
      {runs.map((run) => {
        const stale = !!run.superseded_at || Date.parse(run.expires_at) <= asOf;
        return <SectionCard key={run.id} icon={BrainCircuit} tone={stale ? "slate" : "violet"} title={<span className="flex flex-wrap gap-2">{run.decision ? LOOP_ACTION_LABELS[run.decision.action] : STATUS[run.status]} <Badge tone={stale ? "neutral" : "info"}>{stale ? "No vigente" : STATUS[run.status]}</Badge></span>}>
          <div className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">{date(run.created_at)} · Política {run.policy_version} · Revisión {run.review_version}</p>
            {run.decision && <p className="text-sm">{run.decision.reason}</p>}
            <div className="flex flex-wrap gap-4 text-sm"><Link className="text-primary underline" href={`/dashboard/leads/${run.lead_id}`}>Ficha 360</Link><Link className="text-primary underline" href={url(page, run.id)}>Ver evidencia y revisión</Link></div>
            {run.review && <p className="text-sm">Última revisión: {run.review.recommendation === "accepted" ? "aceptada" : "rechazada"}; hechos {run.review.extraction === "confirmed" ? "confirmados" : run.review.extraction === "rejected" ? "rechazados" : "no confirmados"}.</p>}
            {run.error_code && <Callout tone="warning"><span title={`Código: ${run.error_code}`}>Este análisis no pudo completarse. Atlas lo reintenta solo, hasta tres veces y dentro del cupo diario; no tienes que hacer nada.</span></Callout>}
            {activeRun?.id === run.id && <div className="space-y-4 border-t border-border pt-4">
              <p className="break-all font-mono text-xs text-muted-foreground">Decisión {run.id} · Fuente {run.source_hash}</p>
              <h3 className="text-sm font-semibold">Comprobar la fuente original</h3>
              <RecordingAudioPlayer recordingId={run.recording_id} playable />
              {transcriptResult.data?.status === "completed" && <details className="text-sm"><summary className="cursor-pointer text-primary">Ver transcripción actual</summary>
                <p className="mt-2 text-xs text-muted-foreground">La transcripción actual puede diferir de versiones históricas. Confirma hablantes y contexto escuchando el audio.</p>
                <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3">{transcriptResult.data.transcript_text}</p>
              </details>}
              <h3 className="text-sm font-semibold">Hechos candidatos y evidencia literal</h3>
              {run.analysis?.facts.length ? run.analysis.facts.map((fact, index) => <blockquote key={index} className="rounded-r-lg border-l-2 border-primary bg-primary/5 py-1.5 pl-3 pr-2 text-sm"><p>{fact.quote}</p><footer className="mt-1 text-xs text-muted-foreground">{fact.kind} · {fact.speaker === "customer" ? "cliente inferido" : fact.speaker === "agent" ? "agente inferido" : "hablante incierto"}{fact.requested_time_text ? ` · Referencia temporal: ${fact.requested_time_text}` : ""}</footer></blockquote>) : <p className="text-sm text-muted-foreground">No se extrajeron hechos respaldados.</p>}
              <p className="text-xs text-muted-foreground">Memorias previas utilizadas: {run.decision?.memory_ids.length ?? 0}. Las citas prueban procedencia; la interpretación requiere revisión. Puedes retirar hechos incorrectos desde la ficha 360, aunque su decisión haya vencido.</p>
              {!stale && run.status === "completed" ? <LearningLoopReview runId={run.id} version={run.review_version} /> : <Callout>Esta versión no admite revisión operativa. Se conserva como historia.</Callout>}
              <h3 className="text-sm font-semibold">Feedback y resultados observados (últimos 30 eventos)</h3>
              {feedback.length ? feedback.map((item) => <div key={item.id} className="border-b border-border py-2 text-sm"><p>{date(item.created_at)} · {item.kind === "human_review" ? "Revisión humana" : item.kind === "source_revision" ? "Corrección de la gestión fuente" : "Gestión posterior observada"}</p><p className="text-muted-foreground">{item.kind === "human_review" ? String(item.payload.note ?? "") : [item.payload.status, item.payload.outcome, item.payload.reason].filter(Boolean).map(String).join(" · ") || "Resultado retirado o aún no definido"}</p></div>) : <p className="text-sm text-muted-foreground">Aún no hay feedback ni resultados posteriores disponibles.</p>}
            </div>}
          </div>
        </SectionCard>;
      })}
      <nav aria-label="Páginas del loop" className="flex gap-2 text-sm">{page > 1 && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={url(page - 1)}>Anterior</Link>}{(runsResult.count ?? 0) > page * 20 && <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href={url(page + 1)}>Siguiente</Link>}</nav>
    </>}
  </div>;
}
