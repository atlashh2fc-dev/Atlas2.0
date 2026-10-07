"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import {
  agreementRate,
  CALL_VALIDITIES,
  mapPautaRow,
  PAUTA_COLUMNS,
  parsePautaRows,
  pautaRubricKey,
  QUALITY_ACTIONS,
  scorePauta,
  selectRubric,
  type AiCriterionStatus,
  type PautaRubric,
  type PautaScale,
} from "@/lib/quality-pauta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/* ------------------------------------------------------------------------ */
/* Validación de una llamada                                                 */
/* ------------------------------------------------------------------------ */

const reviewSchema = z.object({
  recordingId: z.uuid(),
  rubricKey: z.string().min(1).max(120),
  callValidity: z.enum(CALL_VALIDITIES as [string, ...string[]]),
  criteria: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        status: z.enum(["cumple", "parcial", "no_cumple", "no_aplica"]),
        comment: z.string().trim().max(600).optional().default(""),
      }),
    )
    .max(40),
  action: z.enum(QUALITY_ACTIONS as [string, ...string[]]),
  comment: z.string().trim().max(4000).optional().default(""),
});

export type SaveReviewResult =
  | { ok: true; score: number | null; verdict: string }
  | { ok: false; error: string };

type EvaluationForReview = {
  id: string;
  rubric_key: string;
  rubric_version: number;
  rubric_snapshot: { pauta?: { id?: string; key?: string; version?: number; name?: string }; rubric?: PautaRubric; scale?: PautaScale } | null;
  pauta_id: string | null;
  overall_score: number | string | null;
  criteria: { id: string; status: AiCriterionStatus }[];
};

/**
 * Guarda la validación de la analista: confirma o corrige atributo por
 * atributo lo que dijo la IA. La nota se recalcula acá con la escala de la
 * pauta; la pantalla solo muestra una vista previa. Queda como nota oficial.
 */
export async function saveQualityReview(input: unknown): Promise<SaveReviewResult> {
  const profile = await requireProfile(["admin", "supervisor", "calidad"]);
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revisa los atributos: falta marcar alguno o hay un texto demasiado largo." };
  const value = parsed.data;

  // La sesión decide el alcance: si RLS no deja ver la grabación, no se valida.
  const supabase = await createClient();
  const { data: recording, error: recordingError } = await supabase
    .from("call_recordings")
    .select("id, call_id, campaign_id, agent_id, started_at")
    .eq("id", value.recordingId)
    .maybeSingle();
  if (recordingError) return { ok: false, error: "No se pudo consultar la grabación." };
  if (!recording) return { ok: false, error: "La grabación no existe o no está dentro de tu alcance." };

  const admin = createAdminClient();
  const [{ data: campaign }, { data: evaluations }, { data: call }] = await Promise.all([
    admin.from("campaigns").select("organization_id").eq("id", recording.campaign_id).maybeSingle(),
    admin
      .from("call_quality_evaluations")
      .select("id, rubric_key, rubric_version, rubric_snapshot, pauta_id, overall_score, criteria")
      .eq("recording_id", recording.id)
      .eq("status", "completed")
      .not("pauta_id", "is", null)
      .order("updated_at", { ascending: false }),
    recording.call_id
      ? admin.from("calls").select("outcome").eq("id", recording.call_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!campaign) return { ok: false, error: "No se encontró la campaña de la llamada." };

  // La rúbrica sale de la evaluación IA si la hay (misma versión de la pauta);
  // si no, de la pauta vigente de la campaña.
  const evaluationList = (evaluations ?? []) as EvaluationForReview[];
  const evaluation = evaluationList.find((row) => row.rubric_key === value.rubricKey) ?? null;
  let pautaId: string | null = null;
  let pautaKey = "";
  let pautaVersion = 1;
  let pautaName = "";
  let rubric: PautaRubric | null = null;
  let scale: PautaScale | null = null;
  let objective = 95;

  const { data: vigente } = await admin
    .from("quality_pautas")
    .select(PAUTA_COLUMNS)
    .eq("status", "vigente")
    .contains("campaign_ids", [recording.campaign_id])
    .limit(1)
    .maybeSingle();
  const pauta = vigente ? mapPautaRow(vigente as Record<string, unknown>) : null;

  if (evaluation?.rubric_snapshot?.rubric) {
    rubric = evaluation.rubric_snapshot.rubric;
    scale = evaluation.rubric_snapshot.scale ?? null;
    pautaId = evaluation.pauta_id;
    pautaKey = evaluation.rubric_snapshot.pauta?.key ?? "";
    pautaVersion = evaluation.rubric_version;
    pautaName = evaluation.rubric_snapshot.pauta?.name ?? "";
  } else if (pauta) {
    rubric =
      pauta.rubrics.find((candidate) => pautaRubricKey(pauta.key, candidate.key) === value.rubricKey) ??
      selectRubric(pauta, (call as { outcome: string | null } | null)?.outcome ?? null);
    scale = pauta.scale;
    pautaId = pauta.id;
    pautaKey = pauta.key;
    pautaVersion = pauta.version;
    pautaName = pauta.name;
    objective = pauta.objective;
  }
  if (!rubric || !scale) return { ok: false, error: "Esta campaña no tiene una pauta de calidad vigente." };
  if (pauta && pauta.id === pautaId) objective = pauta.objective;

  const valid = value.callValidity === "valida";
  const byId = new Map(value.criteria.map((criterion) => [criterion.id, criterion]));
  if (valid && rubric.criteria.some((criterion) => !byId.has(criterion.id))) {
    return { ok: false, error: "Marca el resultado de todos los atributos antes de guardar." };
  }

  const reviewCriteria = rubric.criteria.flatMap((criterion) => {
    const result = byId.get(criterion.id);
    if (!result) return [];
    const aiStatus = evaluation?.criteria.find((item) => item.id === criterion.id)?.status ?? null;
    return [{
      id: criterion.id,
      name: criterion.name,
      weight: criterion.weight,
      status: result.status,
      ai_status: aiStatus,
      comment: result.comment || null,
    }];
  });
  const score = scorePauta(rubric, reviewCriteria, scale, value.callValidity as Parameters<typeof scorePauta>[3]);
  const agreement = evaluation ? agreementRate(reviewCriteria, evaluation.criteria) : null;

  const now = new Date().toISOString();
  const { error } = await admin.from("call_quality_reviews").upsert(
    {
      recording_id: recording.id,
      evaluation_id: evaluation?.id ?? null,
      pauta_id: pautaId,
      rubric_key: pautaKey ? pautaRubricKey(pautaKey, rubric.key) : value.rubricKey,
      rubric_version: pautaVersion,
      rubric_snapshot: { pauta: { id: pautaId, key: pautaKey, version: pautaVersion, name: pautaName }, rubric, scale, objective },
      reviewer_id: profile.id,
      organization_id: campaign.organization_id,
      campaign_id: recording.campaign_id,
      agent_id: recording.agent_id,
      call_started_at: recording.started_at,
      call_validity: value.callValidity,
      criteria: reviewCriteria,
      overall_score: valid ? score.score : null,
      verdict: score.verdict,
      critical_errors: valid ? score.criticalErrors : 0,
      non_critical_errors: valid ? score.nonCriticalErrors : 0,
      ai_score: evaluation?.overall_score === null || evaluation?.overall_score === undefined ? null : Number(evaluation.overall_score),
      ai_agreement: agreement,
      action: value.action,
      comment: value.comment || null,
      updated_at: now,
    },
    { onConflict: "recording_id" },
  );
  if (error) return { ok: false, error: "No se pudo guardar la validación. Intenta nuevamente." };

  revalidatePath("/dashboard/calidad", "layout");
  return { ok: true, score: valid ? score.score : null, verdict: score.verdict };
}

/* ------------------------------------------------------------------------ */
/* Pautas                                                                    */
/* ------------------------------------------------------------------------ */

const MAX_PAUTA_BYTES = 2 * 1024 * 1024;

function slugKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "pauta";
}

export type PautaActionResult = { ok: true; message: string; warnings: string[] } | { ok: false; error: string };

/** Empresa que está mirando quien sube la pauta (RLS-safe). */
async function currentOrganizationId() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_org_id");
  return typeof data === "string" ? data : null;
}

/**
 * Carga una planilla de rúbrica como nueva versión. La versión anterior queda
 * archivada (las notas históricas conservan su snapshot); campañas, objetivo y
 * muestra diaria se heredan si no se cambian.
 */
export async function uploadPauta(formData: FormData): Promise<PautaActionResult> {
  const profile = await requireProfile(["admin", "calidad"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Adjunta la planilla de la pauta (.xlsx)." };
  if (file.size > MAX_PAUTA_BYTES) return { ok: false, error: "La planilla supera 2 MB." };
  if (!/\.(xlsx|xls)$/i.test(file.name)) return { ok: false, error: "La pauta debe venir en Excel (.xlsx)." };

  const organizationId = await currentOrganizationId();
  if (!organizationId) return { ok: false, error: "No se pudo identificar tu empresa." };

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ReturnType<typeof parsePautaRows> | null = null;
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null });
      const candidate = parsePautaRows(rows);
      if (candidate.rubrics.length > 0) {
        parsed = candidate;
        break;
      }
    }
  } catch {
    return { ok: false, error: "No se pudo leer la planilla. Revisa que sea un Excel válido." };
  }
  if (!parsed) {
    return { ok: false, error: "No encontré rúbricas en la planilla. Cada bloque debe empezar con «RUBRICA- NOMBRE» y tener Atributo, Peso y Definición." };
  }

  const existingKey = String(formData.get("pauta_key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const admin = createAdminClient();

  const { data: previousRows } = existingKey
    ? await admin
        .from("quality_pautas")
        .select(PAUTA_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("key", existingKey)
        .order("version", { ascending: false })
    : { data: [] };
  const previous = (previousRows ?? []).map((row) => mapPautaRow(row as Record<string, unknown>));
  const latest = previous[0] ?? null;
  const active = previous.find((row) => row.status === "vigente") ?? null;
  const key = latest?.key ?? slugKey(name || file.name.replace(/\.[^.]+$/, ""));
  const version = (latest?.version ?? 0) + 1;

  if (active) {
    const { error } = await admin.from("quality_pautas").update({ status: "archivada", updated_at: new Date().toISOString() }).eq("id", active.id);
    if (error) return { ok: false, error: "No se pudo archivar la versión anterior." };
  }
  const { error: insertError } = await admin.from("quality_pautas").insert({
    organization_id: organizationId,
    key,
    version,
    name: name || latest?.name || file.name.replace(/\.[^.]+$/, ""),
    campaign_ids: active?.campaignIds ?? latest?.campaignIds ?? [],
    status: "vigente",
    rubrics: parsed.rubrics,
    scale: parsed.scale,
    objective: active?.objective ?? 95,
    min_seconds: active?.minSeconds ?? 60,
    sample_outcomes: active?.sampleOutcomes ?? ["sale", "interested", "callback", "not_interested"],
    daily_sample_per_agent: active?.dailySamplePerAgent ?? 0,
    notes: parsed.warnings.length ? parsed.warnings.join(" ") : null,
    source_filename: file.name.slice(0, 200),
    source_sha256: createHash("sha256").update(buffer).digest("hex"),
    created_by: profile.id,
  });
  if (insertError) {
    if (active) await admin.from("quality_pautas").update({ status: "vigente" }).eq("id", active.id);
    return { ok: false, error: "No se pudo guardar la pauta. La versión anterior sigue vigente." };
  }

  revalidatePath("/dashboard/calidad", "layout");
  const criteria = parsed.rubrics.reduce((sum, rubric) => sum + rubric.criteria.length, 0);
  return {
    ok: true,
    message: `Versión ${version} vigente: ${parsed.rubrics.length} rúbrica${parsed.rubrics.length === 1 ? "" : "s"} y ${criteria} atributos.`,
    warnings: parsed.warnings,
  };
}

const settingsSchema = z.object({
  pautaId: z.uuid(),
  campaignIds: z.array(z.uuid()).max(200),
  objective: z.number().min(0).max(100),
  minSeconds: z.number().int().min(0).max(3600),
  dailySamplePerAgent: z.number().int().min(0).max(50),
});

/** Campañas, objetivo y muestra automática de la pauta vigente. */
export async function updatePautaSettings(input: unknown): Promise<PautaActionResult> {
  await requireProfile(["admin", "calidad"]);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revisa los valores: objetivo 0–100, muestra 0–50 por ejecutivo y día." };
  const value = parsed.data;

  // RLS: solo pautas de la empresa que se está mirando.
  const supabase = await createClient();
  const { data: pauta } = await supabase.from("quality_pautas").select("id, organization_id").eq("id", value.pautaId).maybeSingle();
  if (!pauta) return { ok: false, error: "La pauta no existe o no es de tu empresa." };

  const admin = createAdminClient();
  const { data: validCampaigns } = value.campaignIds.length
    ? await admin.from("campaigns").select("id").eq("organization_id", pauta.organization_id).in("id", value.campaignIds)
    : { data: [] };
  const { error } = await admin
    .from("quality_pautas")
    .update({
      campaign_ids: (validCampaigns ?? []).map((row) => row.id as string),
      objective: value.objective,
      min_seconds: value.minSeconds,
      daily_sample_per_agent: value.dailySamplePerAgent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", value.pautaId);
  if (error) return { ok: false, error: "No se pudo guardar la configuración." };

  revalidatePath("/dashboard/calidad", "layout");
  return { ok: true, message: "Configuración guardada.", warnings: [] };
}
