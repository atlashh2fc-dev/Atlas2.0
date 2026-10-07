import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/cron-autorizado";
import { mapPautaRow, PAUTA_COLUMNS, type QualityPauta } from "@/lib/quality-pauta";
import { evaluateRecordingWithPauta, QualityPipelineError } from "@/lib/quality-pipeline.server";
import { startOfDay } from "@/lib/report-range";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Muestra automática de calidad (Vercel Cron, cada 10 minutos en horario de
 * operación). Por cada pauta vigente con muestra diaria, toma llamadas de hoy
 * de cada ejecutivo hasta completar su cupo y las deja transcritas y evaluadas
 * por la IA, listas para que Calidad las valide.
 *
 * El orden dentro del día es pseudoaleatorio (hash del id), para que la
 * muestra no sean siempre las primeras llamadas de la mañana. Una llamada que
 * falló dos veces no se reintenta.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_RUN = 5;
const TIME_BUDGET_MS = 230_000;

type Candidate = {
  id: string;
  agent_id: string;
  call_id: string | null;
  duration_seconds: number | string | null;
  queue_talk_seconds: number | null;
};

function sampleOrder(id: string) {
  return createHash("sha256").update(id).digest("hex");
}

async function pickForPauta(admin: ReturnType<typeof createAdminClient>, pauta: QualityPauta, since: string) {
  if (pauta.campaignIds.length === 0) return [];
  const { data: recordings, error } = await admin
    .from("call_recordings")
    .select("id, agent_id, call_id, duration_seconds, queue_talk_seconds")
    .in("campaign_id", pauta.campaignIds)
    .eq("status", "ready")
    .gt("duration_seconds", pauta.minSeconds)
    .gte("started_at", since)
    .not("agent_id", "is", null)
    .limit(3000);
  if (error) throw new Error(error.message);

  const complete = ((recordings ?? []) as Candidate[]).filter(
    (row) => row.queue_talk_seconds === null || Number(row.duration_seconds) >= row.queue_talk_seconds - 2,
  );
  if (complete.length === 0) return [];
  const ids = complete.map((row) => row.id);
  const callIds = complete.map((row) => row.call_id).filter((id): id is string => Boolean(id));

  const [{ data: calls }, { data: evaluations }, { data: transcriptions }] = await Promise.all([
    callIds.length ? admin.from("calls").select("id, outcome").in("id", callIds) : Promise.resolve({ data: [] }),
    admin.from("call_quality_evaluations").select("recording_id, status, attempt_count").eq("pauta_id", pauta.id).in("recording_id", ids),
    admin.from("call_transcriptions").select("recording_id, status, attempt_count").in("recording_id", ids),
  ]);
  const outcomes = new Map(((calls ?? []) as { id: string; outcome: string | null }[]).map((row) => [row.id, row.outcome]));
  const evaluated = new Map(((evaluations ?? []) as { recording_id: string; status: string; attempt_count: number }[]).map((row) => [row.recording_id, row]));
  const failedTranscriptions = new Set(
    ((transcriptions ?? []) as { recording_id: string; status: string; attempt_count: number }[])
      .filter((row) => row.status === "failed" && row.attempt_count >= 2)
      .map((row) => row.recording_id),
  );

  const taken = new Map<string, number>();
  const pool = new Map<string, Candidate[]>();
  for (const row of complete) {
    const existing = evaluated.get(row.id);
    const done = existing && (existing.status !== "failed" || existing.attempt_count >= 2);
    if (done) {
      if (existing.status !== "failed") taken.set(row.agent_id, (taken.get(row.agent_id) ?? 0) + 1);
      continue;
    }
    if (failedTranscriptions.has(row.id)) continue;
    const outcome = row.call_id ? outcomes.get(row.call_id) ?? null : null;
    if (!outcome || !pauta.sampleOutcomes.includes(outcome)) continue;
    const list = pool.get(row.agent_id) ?? [];
    list.push(row);
    pool.set(row.agent_id, list);
  }

  // Ronda por ejecutivo: el que va más atrasado en su cupo va primero.
  const queue: string[] = [];
  const agents = [...pool.keys()].sort((a, b) => (taken.get(a) ?? 0) - (taken.get(b) ?? 0));
  for (const agentId of agents) {
    const remaining = pauta.dailySamplePerAgent - (taken.get(agentId) ?? 0);
    if (remaining <= 0) continue;
    const ordered = (pool.get(agentId) ?? []).sort((a, b) => sampleOrder(a.id).localeCompare(sampleOrder(b.id)));
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

  const since = startOfDay(new Date()).toISOString();
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
