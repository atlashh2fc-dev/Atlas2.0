"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { SEGMENTOS, type SegmentoId } from "@/lib/campanas-clinica";
import { esFechaValida, instanteEnChile } from "@/lib/citas";
import { despacharMensajes } from "@/lib/mensajes/despachar";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 300): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

export async function crearCampana(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const nombre = texto(formData, "nombre", 120);
  const segmento = texto(formData, "segmento", 40) as SegmentoId;
  const canal = texto(formData, "canal", 20);
  const cuerpo = texto(formData, "texto", 2000);
  if (nombre.length < 3) throw new Error("Ponle nombre a la campaña.");
  const definicion = SEGMENTOS.find((candidato) => candidato.id === segmento);
  if (!definicion) throw new Error("Elige el segmento.");
  if (!["auto", "whatsapp", "correo"].includes(canal)) throw new Error("Elige el canal.");
  if (cuerpo.length < 10) throw new Error("Escribe el mensaje.");

  const parametros: Record<string, unknown> = {};
  if (definicion.parametro) {
    const valor = texto(formData, "parametro", 40) || definicion.porDefecto;
    parametros[definicion.parametro] = definicion.parametro === "especie" ? valor : Number(valor);
  }
  const fecha = texto(formData, "fecha", 10);
  const hora = texto(formData, "hora", 5) || "10:00";
  const programada = fecha && esFechaValida(fecha) ? instanteEnChile(fecha, /^\d{2}:\d{2}$/.test(hora) ? hora : "10:00").toISOString() : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campanas_de_clinica")
    .insert({ nombre, segmento, parametros, canal, asunto: texto(formData, "asunto", 200) || nombre, texto: cuerpo, programada_para: programada })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/campanas-clinica");
  redirect(`/dashboard/campanas-clinica?c=${data.id}`);
}

export async function lanzarCampana(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "campana_id");
  if (!UUID.test(id)) throw new Error("Campaña inválida.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("lanzar_campana_de_clinica", { p_campana: id });
  if (error) throw new Error(error.message);
  // Lo que toca ahora sale ahora; lo programado espera su hora.
  await despacharMensajes({ generar: false, limite: 100 });
  revalidatePath("/dashboard/campanas-clinica");
  revalidatePath("/dashboard/recordatorios");
}

export async function cancelarCampana(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "campana_id");
  if (!UUID.test(id)) throw new Error("Campaña inválida.");
  const supabase = await createClient();
  const ahora = new Date().toISOString();
  await supabase.from("mensajes_salientes").update({ estado: "cancelado", updated_at: ahora }).eq("origen_ref", id).eq("regla", "campana").eq("estado", "programado");
  const { error } = await supabase.from("campanas_de_clinica").update({ estado: "cancelada", updated_at: ahora }).eq("id", id).in("estado", ["borrador", "programada"]);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/campanas-clinica");
}
