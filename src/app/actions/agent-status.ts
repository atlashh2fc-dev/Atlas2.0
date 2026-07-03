"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import type { AgentStatusReason } from "@/lib/types";

/**
 * Motivos de pausa/disponibilidad activos, para el selector de la barra CTI.
 * Cualquier usuario autenticado puede leerlos (RLS: select para
 * "authenticated").
 */
export async function listActiveStatusReasons(): Promise<AgentStatusReason[]> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_status_reasons")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Estado actual del agente que llama (su propia fila, vía RLS
 * profile_id = auth.uid()).
 */
export async function getMyCurrentStatus(): Promise<{ reason: AgentStatusReason } | null> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_current_status")
    .select("reason_id, agent_status_reasons(*)")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reason = (data as any).agent_status_reasons as AgentStatusReason | null;
  return reason ? { reason } : null;
}

/**
 * El agente cambia su propio estado (Disponible/Auxiliar/Baño/Capacitación,
 * etc.). Se guarda en agent_current_status; el motor de discado lo lee
 * (poll ~10s) y sincroniza QueuePause en Asterisk para todas las colas en
 * las que el agente sea miembro — no hace falta tocar el servidor a mano.
 */
export async function setMyCurrentStatus(reasonId: string): Promise<void> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("agent_current_status").upsert(
    {
      profile_id: profile.id,
      reason_id: reasonId,
      since: new Date().toISOString(),
    },
    { onConflict: "profile_id" }
  );
  if (error) throw new Error(error.message);
}

// --- Administración de motivos (solo admin) ---

export async function listAllStatusReasons(): Promise<AgentStatusReason[]> {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_status_reasons").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createStatusReason(formData: FormData) {
  await requireProfile(["admin"]);
  const code = (formData.get("code") as string)?.trim();
  const label = (formData.get("label") as string)?.trim();
  const isPause = formData.get("is_pause") === "on";
  const sortOrder = Number(formData.get("sort_order") ?? 0);
  if (!code || !label) throw new Error("Falta código o etiqueta");

  const supabase = await createClient();
  const { error } = await supabase.from("agent_status_reasons").insert({
    code,
    label,
    is_pause: isPause,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/estados-agente");
}

export async function toggleStatusReasonActive(formData: FormData) {
  await requireProfile(["admin"]);
  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_status_reasons")
    .update({ is_active: !active })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/estados-agente");
}
