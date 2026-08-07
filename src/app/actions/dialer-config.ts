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
  if (!Number.isInteger(wrapupSeconds) || wrapupSeconds < 10 || wrapupSeconds > 600) {
    throw new Error(
      "El tiempo entre llamadas debe ser un entero entre 10 y 600 segundos"
    );
  }

  const callerId = (formData.get("caller_id") as string)?.trim() || null;

  const queueName = (formData.get("queue_name") as string)?.trim();
  if (!queueName) throw new Error("El nombre de la cola es obligatorio");

  const trunkContext = (formData.get("trunk_context") as string)?.trim() || "siptel";
  if (trunkContext !== "siptel") {
    throw new Error("La única ruta saliente habilitada es Siptel");
  }
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

  // Dirección de la campaña: decide qué familia de KPIs se reporta. Cualquier
  // valor inesperado cae a saliente, que es lo que hace el motor por defecto.
  const rawCampaignType = String(formData.get("campaign_type") ?? "outbound");
  const campaignType = ["outbound", "inbound", "blending"].includes(rawCampaignType)
    ? rawCampaignType
    : "outbound";

  // Política de compromisos agendados: a la hora acordada la llamada le entra
  // al ejecutivo que la agendó, no al pool.
  const personalCallbackEnabled = formData.get("personal_callback_enabled") === "true";
  const personalCallbackWindow = Number(formData.get("personal_callback_window_minutes"));
  const personalCallbackRetry = Number(formData.get("personal_callback_retry_seconds"));
  const personalCallbackOnExpiry =
    formData.get("personal_callback_on_expiry") === "release_to_pool" ? "release_to_pool" : "keep_in_agenda";

  if (personalCallbackEnabled) {
    if (!Number.isFinite(personalCallbackWindow) || personalCallbackWindow < 1 || personalCallbackWindow > 480) {
      throw new Error("La ventana de entrega del compromiso debe estar entre 1 y 480 minutos.");
    }
    if (!Number.isFinite(personalCallbackRetry) || personalCallbackRetry < 30 || personalCallbackRetry > 3600) {
      throw new Error("El reintento debe estar entre 30 y 3600 segundos.");
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("dialer_campaign_configs").upsert(
    {
      campaign_id: campaignId,
      campaign_type: campaignType,
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
      personal_callback_enabled: personalCallbackEnabled,
      personal_callback_window_minutes: Number.isFinite(personalCallbackWindow) ? personalCallbackWindow : 30,
      personal_callback_retry_seconds: Number.isFinite(personalCallbackRetry) ? personalCallbackRetry : 120,
      personal_callback_on_expiry: personalCallbackOnExpiry,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id" }
  );

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/campanas");
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}

/**
 * Inicia o detiene SOLO nuevas marcaciones automáticas de una campaña.
 * El estado deseado viene explícito para que un doble envío nunca invierta
 * accidentalmente la orden. Las llamadas que ya están conectadas continúan.
 */
export async function setDialerCampaignActive(formData: FormData) {
  await requireProfile(["admin"]);
  const campaignId = formData.get("campaign_id") as string;
  if (!campaignId) throw new Error("Falta campaign_id");

  const desiredActiveValue = formData.get("desired_active");
  if (desiredActiveValue !== "true" && desiredActiveValue !== "false") {
    throw new Error("Estado de discado inválido");
  }
  const desiredActive = desiredActiveValue === "true";

  const supabase = await createClient();
  const { data: config, error: configError } = await supabase
    .from("dialer_campaign_configs")
    .select("is_active, trunk_context")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (configError) throw new Error(configError.message);
  if (!config) {
    throw new Error("Configura el discador de la campaña antes de iniciarlo");
  }
  if (desiredActive && config.trunk_context !== "siptel") {
    throw new Error("No se puede iniciar: la campaña debe usar la ruta Siptel");
  }

  if (config.is_active !== desiredActive) {
    const { error } = await supabase
      .from("dialer_campaign_configs")
      .update({ is_active: desiredActive, updated_at: new Date().toISOString() })
      .eq("campaign_id", campaignId);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard/admin/campanas");
  revalidatePath(`/dashboard/admin/campanas/${campaignId}`);
}
