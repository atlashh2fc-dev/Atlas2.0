"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loopReviewSchema } from "@/lib/ai-learning-loop";

export async function reviewLearningDecision(input: unknown) {
  await requireProfile(["admin", "supervisor"]);
  const parsed = loopReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Completa la revisión y un motivo de al menos tres caracteres." };
  const value = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_ai_loop_decision", {
    p_run_id: value.runId, p_expected_version: value.expectedVersion,
    p_recommendation: value.recommendation, p_extraction: value.extraction, p_note: value.note,
  });
  if (error) {
    if (error.message.includes("stale_decision")) return { error: "La fuente o el contexto cambió. Actualiza y revisa la versión vigente." };
    if (error.message.includes("review_conflict")) return { error: "Otra persona actualizó la revisión. Recarga antes de continuar." };
    return { error: "No se pudo guardar la revisión dentro de tu alcance autorizado." };
  }
  revalidatePath("/dashboard/calidad/loop");
  return { error: null };
}

export async function configureLearningLoop(input: unknown) {
  await requireProfile(["admin"]);
  const parsed = z.object({ campaignId: z.uuid(), mode: z.enum(["off", "shadow"]), dailyLimit: z.number().int().min(1).max(100) }).strict().safeParse(input);
  if (!parsed.success) return { error: "Configuración inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_ai_loop", {
    p_campaign_id: parsed.data.campaignId, p_mode: parsed.data.mode, p_daily_limit: parsed.data.dailyLimit,
  });
  if (error) return { error: "No se pudo guardar la configuración. Verifica permisos y migración." };
  revalidatePath("/dashboard/calidad/loop");
  return { error: null };
}

export async function retractLearningMemory(input: unknown) {
  await requireProfile(["admin", "supervisor"]);
  const parsed = z.object({ memoryId: z.uuid(), note: z.string().trim().min(3).max(1000) }).strict().safeParse(input);
  if (!parsed.success) return { error: "Indica la memoria y el motivo de retirarla." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retract_ai_loop_memory", { p_memory_id: parsed.data.memoryId, p_note: parsed.data.note });
  if (error) return { error: "No se pudo retirar la memoria dentro de tu alcance autorizado." };
  revalidatePath("/dashboard/calidad/loop");
  revalidatePath("/dashboard/leads/[id]", "page");
  return { error: null };
}
