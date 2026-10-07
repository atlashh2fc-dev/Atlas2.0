import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/cron-autorizado";
import { isSampleableReason, mapPautaRow, PAUTA_COLUMNS, type QualityPauta } from "@/lib/quality-pauta";
import { evaluateRecordingWithPauta, QualityPipelineError } from "@/lib/quality-pipeline.server";
import { startOfDay } from "@/lib/report-range";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Muestra automática de calidad (Vercel Cron, cada 10 minutos en horario de
 * operación). Por cada pauta vigente con muestra diaria, toma llamadas de cada
 * ejecutivo y día (hoy y los 6 anteriores, para completar días que quedaron
 * cortos) hasta tener su cupo de llamadas con nota, y las deja transcritas y
 * evaluadas por la IA, listas para que Calidad las valide.
 *
 * No entran a la muestra las tipificaciones que no son una conversación con el
 * cliente (número erróneo, tercero que no entrega información, corte): la IA
 * las marca «no válidas» y el ejecutivo se quedaba sin nota.
 *
 * El orden dentro del día es pseudoaleatorio (hash del id), para que la
 * muestra no sean siempre las primeras llamadas de la mañana. Una llamada que
 * falló dos veces no se reintenta.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_RUN = 8;
const TIME_BUDGET_MS = 230_000;
/** Días hacia atrás que la muestra completa si quedaron sin evaluar (hoy primero). */
const BACKFILL_DAYS = 7;

type Candidate = {
  id: string;
  agent_id: string;
  call_id: string | null;
  started_at: string;
  duration_seconds: number | string | null;
  queue_talk_seconds: number | null;
};

const CHILE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });

function sampleOrder(id: string) {
  return createHash("sha256").update(id).digest("hex");
}

/**
 * Cola de grabaciones a evaluar: por día (hoy primero, luego los anteriores) y
 * por ejecutivo, hasta que cada uno tenga su cupo de llamadas con nota. Una
 * evaluación «no válida» no cuenta para el cupo; para no gastar sin límite,
 * cada ejecutivo tiene a lo más el doble del cupo en intentos por día.
 */
async function pickForPauta(admin: ReturnType<typeof createAdminClient>, pauta: QualityPauta, since: string) {
  if (pauta.campaignIds.length === 0) return [];
  const { data: recordings, error } = await admin
    .from("call_recordings")
    .select("id, agent_id, call_id, started_at, duration_seconds, queue_talk_seconds")
    .in("campaign_id", pauta.campaignIds)
    .eq("status", "ready")
    .gt("duration_seconds", pauta.minSeconds)
    .gte("started_at", since)
    .not("agent_id", "is", null)
    .limit(10000);
  if (error) throw new Error(error.message);

  const complete = ((recordings ?? []) as Candidate[]).filter(
    (row) => row.queue_talk_seconds === null || Number(row.duration_seconds) >= row.queue_talk_seconds - 2,
  );
  if (complete.length === 0) return [];
  const ids = complete.map((row) => row.id);
  const callIds = complete.map((row) => row.call_id).filter((id): id is string => Boolean(id));

  const chunks = <T,>(list: T[], size = 500) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
  const [calls, evaluations, transcriptions] = await Promise.all([
    Promise.all(chunks(callIds).map((chunk) => admin.from("calls").select("id, outcome, reason").in("id", chunk))),
    Promise.all(chunks(ids).map((chunk) => admin.from("call_quality_evaluations").select("recording_id, status, verdict, attempt_count").eq("pauta_id", pauta.id).in("recording_id", chunk))),
    Promise.all(chunks(ids).map((chunk) => admin.from("call_transcriptions").select("recording_id, status, attempt_count").in("recording_id", chunk))),
  ]);
  const callInfo = new Map(
    calls.flatMap((result) => (result.data ?? []) as { id: string; outcome: string | null; reason: string | null }[]).map((row) => [row.id, row]),
  );
  const evaluated = new Map(
    evaluations
      .flatMap((result) => (result.data ?? []) as { recording_id: string; status: string; verdict: string | null; attempt_count: number }[])
      .map((row) => [row.recording_id, row]),
  );
  const failedTranscriptions = new Set(
    transcriptions
      .flatMap((result) => (result.data ?? []) as { recording_id: string; status: string; attempt_count: number }[])
      .filter((row) => row.status === "failed" && row.attempt_count >= 2)
      .map((row) => row.recording_id),
  );

  type Bucket = { valid: number; attempts: number; pool: Candidate[] };
  const buckets = new Map<string, Bucket>();
  for (const row of complete) {
    const key = `${CHILE_DAY.format(new Date(row.started_at))}|${row.agent_id}`;
    const bucket = buckets.get(key) ?? { valid: 0, attempts: 0, pool: [] };
    buckets.set(key, bucket);
    const existing = evaluated.get(row.id);
    if (existing) {
      if (existing.status !== "failed") bucket.attempts += 1;
      if (existing.status === "processing" || (existing.status === "completed" && existing.verdict !== "no_evaluable")) bucket.valid += 1;
      if (existing.status !== "failed" || existing.attempt_count >= 2) continue;
    }
    if (failedTranscriptions.has(row.id)) continue;
    const call = row.call_id ? callInfo.get(row.call_id) : undefined;
    if (!call?.outcome || !pauta.sampleOutcomes.includes(call.outcome)) continue;
    if (!isSampleableReason(call.reason)) continue;
    bucket.pool.push(row);
  }

  // Hoy primero; dentro del día, el ejecutivo más atrasado en su cupo primero.
  const queue: string[] = [];
  const keys = [...buckets.keys()].sort((a, b) => {
    const [dayA, agentA] = a.split("|");
    const [dayB, agentB] = b.split("|");
    if (dayA !== dayB) return dayB.localeCompare(dayA);
    return (buckets.get(a)!.valid - buckets.get(b)!.valid) || agentA.localeCompare(agentB);
  });
  for (const key of keys) {
    const bucket = buckets.get(key)!;
    const remaining = Math.min(pauta.dailySamplePerAgent - bucket.valid, pauta.dailySamplePerAgent * 2 - bucket.attempts);
    if (remaining <= 0) continue;
    const ordered = bucket.pool.sort((a, b) => sampleOrder(a.id).localeCompare(sampleOrder(b.id)));
    queue.push(...ordered.slice(0, remaining).map((row) => row.id));
  }
  return queue;
}

export async function GET(request: Request) {
  if (!cronAutorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.GROQ_API_KEY?.trim() || !process.env.INCEPTION_API_KEY?.trim()) {
    return NextResponse.json({ ok: true, omitido: "Faltan las claves de transcripción o evaluación." });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const { data: pautaRows, error } = await admin
    .from("quality_pautas")
    .select(PAUTA_COLUMNS)
    .eq("status", "vigente")
    .gt("daily_sample_per_agent", 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const since = startOfDay(new Date(Date.now() - (BACKFILL_DAYS - 1) * 86_400_000)).toISOString();
  const results: Record<string, unknown>[] = [];
  let processed = 0;

  for (const row of pautaRows ?? []) {
    const pauta = mapPautaRow(row as Record<string, unknown>);
    let queue: string[] = [];
    try {
      queue = await pickForPauta(admin, pauta, since);
    } catch (pickError) {
      results.push({ pauta: pauta.key, error: pickError instanceof Error ? pickError.message : "Error al elegir la muestra" });
      continue;
    }
    for (const recordingId of queue) {
      if (processed >= MAX_PER_RUN || Date.now() - startedAt > TIME_BUDGET_MS) break;
      processed += 1;
      try {
        const result = await evaluateRecordingWithPauta(admin, recordingId, { id: null, role: null, origin: "muestra" });
        results.push({ pauta: pauta.key, recordingId, ok: true, reused: result.reused });
      } catch (evaluationError) {
        const message = evaluationError instanceof QualityPipelineError || evaluationError instanceof Error ? evaluationError.message : "Error";
        console.error(`[calidad-muestra] ${recordingId}: ${message}`);
        results.push({ pauta: pauta.key, recordingId, ok: false, error: message });
      }
    }
  }

  return NextResponse.json({ ok: true, procesadas: processed, resultados: results });
}
