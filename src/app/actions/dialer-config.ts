"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import type { DialMode } from "@/lib/types";

const VALID_DIAL_MODES: DialMode[] = ["manual", "preview", "progressive", "predictive"];

/**
 * Crea o actualiza la config de discado de una campaña (dialer_campaign_configs).
 * Antes de esto la tabla solo tenía policy de SELECT: no había forma de
 * tocar esto desde la UI, solo a mano en la base de datos.
 */
export async function upsertDialerCampaignConfig(formData: FormData) {
  await requireProfile(["admin"]);

  const campaignId = formData.get("campaign_id") as string;
  if (!campaignId) throw new Error("Falta campaign_id");

  const dialMode = formData.get("dial_mode") as string;
  if (!VALID_DIAL_MODES.includes(dialMode as DialMode)) {
    throw new Error("Modo de discado inválido");
  }

  const maxDialRatio = Number(formData.get("max_dial_ratio"));
  if (!Number.isFinite(maxDialRatio) || maxDialRatio <= 0) {
    throw new Error("El ratio de discado debe ser un número mayor a 0");
  }

  const wrapupSeconds = Number(formData.get("wrapup_seconds"));
  if (!Number.isInteger(wrapupSeconds) || wrapupSeconds < 0 || wrapupSeconds > 600) {
    throw new Error("El tiempo entre llamadas debe ser un entero entre 0 y 600 segundos");
  }

  const callerId = (formData.get("caller_id") as string)?.trim() || null;

  const queueName = (formData.get("queue_name") as string)?.trim();
  if (!queueName) throw new Error("El nombre de la cola es obligatorio");

  const trunkContext = (formData.get("trunk_context") as string)?.trim() || "twilio";
  const isActive = formData.get("is_active") === "true";

  const maxRedialAttempts = Number(formData.get("max_redial_attempts"));
  if (!Number.isInteger(maxRedialAttempts) || maxRedialAttempts < 0 || maxRedialAttempts > 20) {
    throw new Error("El tope de reintentos debe ser un entero entre 0 y 20");
  }

  const abandonTimeoutSeconds = Number(formData.get("abandon_timeout_seconds"));
  if (!Number.isInteger(abandonTimeoutSeconds) || abandonTimeoutSeconds < 10 || abandonTimeoutSeconds > 600) {
    throw new Error("El timeout de cola debe ser un entero entre 10 y 600 segundos");
  }

  const targetAbandonmentRate = Number(formData.get("target_abandonment_rate"));
  if (!Number.isFinite(targetAbandonmentRate) || targetAbandonmentRate < 0 || targetAbandonmentRate > 100) {
    throw new Error("La tasa de abandono objetivo debe ser un número entre 0 y 100");
  }

  const amdEnabled = formData.get("amd_enabled") === "true";

  const supabase = await createClient();
  const { error } = await supabase.from("dialer_campaign_configs").upsert(
    {
      campaign_id: campaignId,
      dial_mode: dialMode,
      max_dial_ratio: maxDialRatio,
      caller_id: callerId,
      trunk_context: trunkContext,
      queue_name: queueName,
      wrapup_seconds: wrapupSeconds,
      is_active: isActive,
      max_redial_attempts: maxRedialAttempts,
      abandon_timeout_seconds: abandonTimeoutSeconds,
      target_abandonment_rate: targetAbandonmentRate,
      amd_enabled: amdEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id" }
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

/**
 * Pausa/reanuda SOLO el discado automático de la campaña (is_active de
 * dialer_campaign_configs), sin tocar el resto de la config. Antes la única
 * forma de pausar era reenviar el formulario completo — mal para un botón
 * de "frená el discador ya" en medio de un incidente, donde re-tipear el
 * ratio/cola a las apuradas es justo el tipo de error que no querés cometer.
 * El motor lee dialer_campaign_configs en cada tick (pocos segundos), así
 * que el efecto es casi inmediato.
 */
export async function toggleDialerCampaignActive(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  if (!campaignId) throw new Error("Falta campaign_id");
  const currentlyActive = formData.get("currently_active") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("dialer_campaign_configs")
    .update({ is_active: !currentlyActive, updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}
