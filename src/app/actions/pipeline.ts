"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { despacharMensajes } from "@/lib/mensajes/despachar";
import { createClient } from "@/lib/supabase/server";

/*
 * El puesto de trabajo comercial: asignar un negocio y convertir un prospecto
 * de Atlas Lead en negocio. Todo con la sesión de quien lo hace; la seguridad
 * por fila decide la empresa y el permiso.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 300): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

function revalidar(id?: string) {
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/ventas");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/dashboard/ventas/${id}`);
}

export async function asignarNegocio(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "oportunidad_id");
  const responsable = texto(formData, "responsable") || profile.id;
  if (!UUID.test(id)) throw new Error("Negocio inválido.");
  if (responsable !== "nadie" && !UUID.test(responsable)) throw new Error("Responsable inválido.");
  const supabase = await createClient();
  const { error } = await supabase.from("sales_opportunities").update({ owner_id: responsable === "nadie" ? null : responsable, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidar(id);
}

export async function fijarProximaAccion(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "oportunidad_id");
  const fecha = texto(formData, "fecha", 10);
  const hora = texto(formData, "hora", 5) || "09:00";
  const nota = texto(formData, "nota", 300);
  if (!UUID.test(id)) throw new Error("Negocio inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Elige la fecha.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_opportunities")
    .update({ next_action_at: new Date(`${fecha}T${/^\d{2}:\d{2}$/.test(hora) ? hora : "09:00"}:00-03:00`).toISOString(), next_action_note: nota || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidar(id);
}

/** Un prospecto de Atlas Lead pasa a ser un negocio en la primera etapa, con su empresa y contacto. */
export async function convertirLeadEnNegocio(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const leadId = texto(formData, "lead_id");
  if (!UUID.test(leadId)) throw new Error("Prospecto inválido.");
  const supabase = await createClient();

  const { data: lead, error: leadError } = await supabase.from("leads").select("id, full_name, email, phone, rut, extra, organization_id").eq("id", leadId).single();
  if (leadError || !lead) throw new Error("No encontramos ese prospecto.");
  const extra = (lead.extra ?? {}) as Record<string, unknown>;
  const empresa = String(extra.company ?? extra.empresa ?? extra.razon_social ?? "").trim() || lead.full_name;

  const { data: existente } = await supabase.from("sales_opportunities").select("id").eq("lead_id", leadId).maybeSingle();
  if (existente) redirect(`/dashboard/ventas/${existente.id}`);

  const { data: etapa } = await supabase.from("sales_stages").select("id").eq("active", true).order("position").limit(1).single();
  if (!etapa) throw new Error("No hay etapas configuradas.");

  const { data: cuenta, error: cuentaError } = await supabase
    .from("sales_companies")
    .insert({ organization_id: lead.organization_id, name: empresa, phone: lead.phone, email: lead.email, rut: lead.rut, source: "atlas_lead", crm_entity_id: null, metadata: { contacto: lead.full_name, lead_id: lead.id }, created_by: profile.id })
    .select("id")
    .single();
  if (cuentaError || !cuenta) throw new Error(cuentaError?.message ?? "No se pudo crear la empresa.");

  const { data: negocio, error: negocioError } = await supabase
    .from("sales_opportunities")
    .insert({ organization_id: lead.organization_id, company_id: cuenta.id, name: `${empresa} · desde Atlas Lead`, stage_id: etapa.id, status: "abierta", source: "atlas_lead", lead_id: lead.id, owner_id: profile.id, created_by: profile.id, next_action_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), next_action_note: "Primer contacto" })
    .select("id")
    .single();
  if (negocioError || !negocio) throw new Error(negocioError?.message ?? "No se pudo crear el negocio.");
  revalidar(negocio.id);
  redirect(`/dashboard/ventas/${negocio.id}`);
}

/** Escribirle al contacto del negocio desde Atlas, por correo o WhatsApp; queda en la historia. */
export async function escribirAlNegocio(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const oportunidad = texto(formData, "oportunidad_id");
  const cuenta = texto(formData, "cuenta_id");
  const canal = texto(formData, "canal", 20) === "whatsapp" ? "whatsapp" : "correo";
  const asunto = texto(formData, "asunto", 300);
  const cuerpo = texto(formData, "texto", 5000);
  if (!UUID.test(oportunidad) || !UUID.test(cuenta)) throw new Error("Negocio inválido.");
  if (cuerpo.length < 2) throw new Error("Escribe el mensaje.");

  const supabase = await createClient();
  const { data: mensajeId, error } = await supabase.rpc("programar_mensaje", {
    p_cuenta: cuenta,
    p_plantilla: "libre",
    p_variables: { texto: cuerpo },
    p_regla: "manual",
    p_origen_ref: oportunidad,
    p_programado_para: null,
    p_canal: canal,
  });
  if (error) throw new Error(error.message);
  if (canal === "correo" && typeof mensajeId === "string") {
    await supabase.from("mensajes_salientes").update({ asunto: asunto || "Mensaje de " + (profile.full_name ?? "Atlas") }).eq("id", mensajeId);
  }
  await supabase.from("sales_activities").insert({
    company_id: cuenta,
    opportunity_id: oportunidad,
    kind: canal === "correo" ? "correo" : "whatsapp",
    subject: canal === "correo" ? (asunto || "Correo enviado desde Atlas") : "WhatsApp enviado desde Atlas",
    body: cuerpo.slice(0, 2000),
    occurred_at: new Date().toISOString(),
    done: true,
    owner_id: profile.id,
  });
  await despacharMensajes({ generar: false, limite: 10 });
  revalidar(oportunidad);
}

/** Cerrar el negocio como ganado o perdido, con motivo cuando se pierde. */
export async function cerrarNegocio(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const oportunidad = texto(formData, "oportunidad_id");
  const resultado = texto(formData, "resultado", 10);
  const motivo = texto(formData, "motivo", 400);
  if (!UUID.test(oportunidad)) throw new Error("Negocio inválido.");
  if (resultado !== "ganado" && resultado !== "perdido") throw new Error("Elige ganado o perdido.");
  const supabase = await createClient();
  const { data: etapa } = await supabase.from("sales_stages").select("key").eq("active", true).eq(resultado === "ganado" ? "is_won" : "is_lost", true).limit(1).maybeSingle();
  if (!etapa) throw new Error("No hay una etapa de cierre configurada.");
  const { error } = await supabase.rpc("mover_oportunidad_de_etapa", { p_opportunity_id: oportunidad, p_stage_key: etapa.key, p_note: motivo || null });
  if (error) throw new Error(error.message);
  revalidar(oportunidad);
}

export async function alternarSeguimientoAutomatico(formData: FormData) {
  await requireProfile(["admin"]);
  const activo = String(formData.get("activo") ?? "") === "si";
  const supabase = await createClient();
  const { error } = await supabase.rpc("alternar_seguimiento_automatico", { p_activo: activo });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/ventas/resultados");
}
