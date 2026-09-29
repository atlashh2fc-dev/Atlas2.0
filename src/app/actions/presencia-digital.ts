"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Presencia por canal digital. Voz sigue en el estado de siempre (Disponible o
 * AUX) y lo lee el discador; correo y WhatsApp se prenden o apagan acá, sin
 * tocar la cola de llamadas.
 */
export type PresenciaDigital = {
  tieneCorreo: boolean;
  tieneWhatsapp: boolean;
  /** El canal está prendido por el ejecutivo. */
  correo: boolean;
  whatsapp: boolean;
  /** Prendido y además conectado y sin una pausa que lo cierre: la cola le entrega. */
  recibeCorreo: boolean;
  recibeWhatsapp: boolean;
  pendientesCorreo: number;
  pendientesWhatsapp: number;
};

export type CanalDigital = "correo" | "whatsapp";

function leer(dato: unknown): PresenciaDigital {
  const fila = (dato ?? {}) as Record<string, unknown>;
  return {
    tieneCorreo: fila.tiene_correo === true,
    tieneWhatsapp: fila.tiene_whatsapp === true,
    correo: fila.correo !== false,
    whatsapp: fila.whatsapp !== false,
    recibeCorreo: fila.recibe_correo === true,
    recibeWhatsapp: fila.recibe_whatsapp === true,
    pendientesCorreo: Number(fila.pendientes_correo ?? 0),
    pendientesWhatsapp: Number(fila.pendientes_whatsapp ?? 0),
  };
}

export async function obtenerMiPresenciaDigital(): Promise<PresenciaDigital | null> {
  const profile = await requireProfile();
  if (profile.role !== "agente") return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mi_presencia_digital");
  if (error) throw new Error(error.message);
  return leer(data);
}

export async function cambiarMiPresenciaDigital(canal: CanalDigital, activo: boolean): Promise<PresenciaDigital> {
  await requireProfile(["agente"]);
  if (canal !== "correo" && canal !== "whatsapp") throw new Error("Canal desconocido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cambiar_mi_presencia_digital", { p_canal: canal, p_activo: activo });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/conversaciones", "layout");
  return leer(data);
}
