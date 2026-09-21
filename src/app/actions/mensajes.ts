"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { despacharMensajes } from "@/lib/mensajes/despachar";
import { PLANTILLAS, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { createClient } from "@/lib/supabase/server";

/*
 * Enviar desde Atlas. Un mensaje se programa con la sesión de quien lo pide
 * (la base decide empresa y permiso) y se despacha al tiro; el estado queda
 * en la cola para que la pantalla lo muestre.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 400): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

function revalidar() {
  revalidatePath("/dashboard/recordatorios");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard");
}

/**
 * Programa y envía un mensaje con una plantilla. Las variables llegan como
 * JSON en el formulario, ya resueltas por la pantalla que sabe de qué habla
 * (la hora de la cita, la mascota, el monto).
 */
export async function enviarMensaje(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id");
  const plantilla = texto(formData, "plantilla", 40) as ClavePlantilla;
  const regla = texto(formData, "regla", 40) || "manual";
  const origen = texto(formData, "origen_ref");
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (!(plantilla in PLANTILLAS)) throw new Error("Plantilla desconocida.");
  if (origen && !UUID.test(origen)) throw new Error("Referencia inválida.");

  let variables: Record<string, unknown> = {};
  try {
    variables = JSON.parse(texto(formData, "variables", 4000) || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("Variables inválidas.");
  }
  if (plantilla === "libre") {
    const cuerpo = texto(formData, "texto", 1000);
    if (cuerpo.length < 2) throw new Error("Escribe el mensaje.");
    variables = { texto: cuerpo };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("programar_mensaje", {
    p_cuenta: cuenta,
    p_plantilla: plantilla,
    p_variables: variables,
    p_regla: regla,
    p_origen_ref: origen || null,
    p_programado_para: null,
    p_canal: "whatsapp",
  });
  if (error) throw new Error(error.message);

  // Sale ahora mismo, no en el próximo cron.
  await despacharMensajes({ generar: false, limite: 20 });
  revalidar();
}

export async function cancelarMensaje(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "mensaje_id");
  if (!UUID.test(id)) throw new Error("Mensaje inválido.");
  const supabase = await createClient();
  const { error } = await supabase.from("mensajes_salientes").update({ estado: "cancelado", updated_at: new Date().toISOString() }).eq("id", id).in("estado", ["programado", "fallido"]);
  if (error) throw new Error(error.message);
  revalidar();
}

export async function reintentarMensaje(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "mensaje_id");
  if (!UUID.test(id)) throw new Error("Mensaje inválido.");
  const supabase = await createClient();
  const { error } = await supabase.from("mensajes_salientes").update({ estado: "programado", programado_para: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("estado", "fallido");
  if (error) throw new Error(error.message);
  await despacharMensajes({ generar: false, limite: 20 });
  revalidar();
}

/** Despacha ahora lo que esté programado (el botón "Enviar pendientes"). */
export async function despacharAhora() {
  await requireProfile(["admin", "supervisor"]);
  await despacharMensajes({ generar: true, limite: 100 });
  revalidar();
}
