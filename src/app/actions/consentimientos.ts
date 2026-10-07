"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { clinicaDe } from "@/lib/ediciones";
import { PLANTILLAS_SUGERIDAS } from "@/lib/consentimientos";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { URL_PUBLICA } from "@/lib/mensajes/plantillas";
import { despacharMensajes } from "@/lib/mensajes/despachar";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/*
 * Consentimiento informado: plantillas de la empresa, el documento de cada
 * ficha y su firma (en el mesón o por enlace). El texto firmado queda tal
 * cual: la base no deja modificar un documento firmado, solo anularlo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 200): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

async function empresa() {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_org_id");
  if (typeof data !== "string") throw new Error("Elige una empresa.");
  return { supabase, organizacion: data };
}

export async function crearPlantillaConsentimiento(formData: FormData) {
  const { supabase, organizacion } = await empresa();
  const titulo = texto(formData, "titulo", 120);
  const cuerpo = texto(formData, "texto", 20000);
  if (titulo.length < 3) throw new Error("Escribe el título.");
  if (cuerpo.length < 20) throw new Error("El texto es muy corto.");
  const { error } = await supabase.from("plantillas_consentimiento").insert({ organization_id: organizacion, titulo, texto: cuerpo });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/citas/configuracion");
}

export async function agregarPlantillasSugeridas() {
  const { supabase, organizacion } = await empresa();
  const { edicion } = await contextoDeMiEmpresa();
  const sugeridas = PLANTILLAS_SUGERIDAS[clinicaDe(edicion)];
  const { data: existentes } = await supabase.from("plantillas_consentimiento").select("titulo");
  const ya = new Set((existentes ?? []).map((fila) => String(fila.titulo).toLowerCase()));
  const nuevas = sugeridas.filter((plantilla) => !ya.has(plantilla.titulo.toLowerCase())).map((plantilla) => ({ organization_id: organizacion, ...plantilla }));
  if (nuevas.length) {
    const { error } = await supabase.from("plantillas_consentimiento").insert(nuevas);
    if (error) throw errorDeAccion(error);
  }
  revalidatePath("/dashboard/citas/configuracion");
}

export async function guardarPlantillaConsentimiento(formData: FormData) {
  const { supabase } = await empresa();
  const id = texto(formData, "id", 40);
  if (!UUID.test(id)) throw new Error("Plantilla inválida.");
  const titulo = texto(formData, "titulo", 120);
  const cuerpo = texto(formData, "texto", 20000);
  if (titulo.length < 3 || cuerpo.length < 20) throw new Error("Revisa el título y el texto.");
  const { error } = await supabase
    .from("plantillas_consentimiento")
    .update({ titulo, texto: cuerpo, activo: formData.get("activo") === "si", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/citas/configuracion");
}

export async function crearConsentimiento(formData: FormData) {
  const { supabase } = await empresa();
  const cuenta = texto(formData, "cuenta_id", 40);
  const plantilla = texto(formData, "plantilla_id", 40);
  const mascota = texto(formData, "mascota_id", 40);
  if (!UUID.test(cuenta) || !UUID.test(plantilla)) throw new Error("Elige la plantilla.");
  const { data, error } = await supabase.rpc("crear_consentimiento", { p_cuenta: cuenta, p_plantilla: plantilla, p_mascota: UUID.test(mascota) ? mascota : null });
  if (error) throw errorDeAccion(error);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  redirect(`/dashboard/pacientes/${cuenta}/consentimientos/${data as string}`);
}

export async function firmarConsentimiento(formData: FormData) {
  const { supabase } = await empresa();
  const id = texto(formData, "id", 40);
  const cuenta = texto(formData, "cuenta_id", 40);
  if (!UUID.test(id)) throw new Error("Documento inválido.");
  const firma = String(formData.get("firma") ?? "");
  if (!firma) throw new Error("Falta la firma.");
  const { data, error } = await supabase.rpc("firmar_consentimiento", {
    p_id: id,
    p_nombre: texto(formData, "nombre", 120),
    p_rut: texto(formData, "rut", 20) || null,
    p_firma: firma,
  });
  if (error) throw errorDeAccion(error);
  if (data !== true) throw new Error("Este documento ya estaba firmado o anulado.");
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  revalidatePath(`/dashboard/pacientes/${cuenta}/consentimientos/${id}`);
}

export async function anularConsentimiento(formData: FormData) {
  const { supabase } = await empresa();
  const id = texto(formData, "id", 40);
  const cuenta = texto(formData, "cuenta_id", 40);
  if (!UUID.test(id)) throw new Error("Documento inválido.");
  const { error } = await supabase.from("consentimientos").update({ estado: "anulado" }).eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  revalidatePath(`/dashboard/pacientes/${cuenta}/consentimientos/${id}`);
}

/** Manda el enlace para firmar desde el celular, por WhatsApp (o correo si no hay celular). */
export async function enviarEnlaceConsentimiento(formData: FormData) {
  const { supabase } = await empresa();
  const id = texto(formData, "id", 40);
  if (!UUID.test(id)) throw new Error("Documento inválido.");
  const { data: doc, error } = await supabase.from("consentimientos").select("cuenta_id, titulo, token, estado, sales_companies(name, phone, email)").eq("id", id).maybeSingle();
  if (error || !doc) throw errorDeAccion(error ?? new Error("No encontramos el documento."));
  if (doc.estado !== "pendiente") throw new Error("Este documento ya no está pendiente de firma.");
  const persona = (Array.isArray(doc.sales_companies) ? doc.sales_companies[0] : doc.sales_companies) as { name: string; phone: string | null; email: string | null } | null;
  const canal = persona?.phone?.trim() ? "whatsapp" : persona?.email?.trim() ? "correo" : null;
  if (!canal) throw new Error("La ficha no tiene celular ni correo.");
  const { empresa: nombreEmpresa } = await contextoDeMiEmpresa();
  const cuerpo = `Hola ${persona?.name.split(" ")[0] ?? ""}, te dejamos el consentimiento «${doc.titulo}» de ${nombreEmpresa ?? "la clínica"} para que lo leas y firmes desde tu celular: ${URL_PUBLICA}/firmar/${doc.token}`;
  const { error: mensajeError } = await supabase.rpc("programar_mensaje", {
    p_cuenta: doc.cuenta_id,
    p_plantilla: "libre",
    p_variables: { texto: cuerpo },
    p_regla: "manual",
    p_origen_ref: id,
    p_programado_para: null,
    p_canal: canal,
  });
  if (mensajeError) throw errorDeAccion(mensajeError);
  await despacharMensajes({ generar: false, limite: 5 });
  revalidatePath(`/dashboard/pacientes/${doc.cuenta_id}/consentimientos/${id}`);
}
