"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { buzonDeEmpresa } from "@/lib/correo/buzon";
import { enviarCorreo } from "@/lib/correo/smtp";
import { asuntoDeRespuesta, COPIA_OCULTA_EQUIFAX, respuestaHtml, respuestaTexto } from "@/lib/equifax-cotizador/correo-cuenta";
import { firmaDesdePerfil, remitenteDeEjecutivo } from "@/lib/equifax-cotizador/propuesta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Contestar desde la ficha lo que el cliente respondió al buzón de la cuenta.
 * La respuesta sale del mismo buzón, con el nombre y la firma de quien
 * contesta y en el mismo hilo (In-Reply-To), así la siguiente respuesta del
 * cliente vuelve a caer en este registro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El correo recibido, leído con los permisos de quien actúa: si no lo ve, no lo contesta. */
async function correoRecibido(leadId: string, correoId: string) {
  if (!UUID.test(leadId) || !UUID.test(correoId)) throw new Error("Falta el correo que quieres contestar.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbound_emails")
    .select("id, lead_id, organization_id, from_name, from_address, subject, message_id")
    .eq("id", correoId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No encontramos ese correo en este registro.");
  return { supabase, correo: data };
}

/** Deja atendidas todas las respuestas pendientes del registro que quien actúa puede ver. */
async function atenderPendientes(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string, actor: string) {
  const { data } = await supabase.from("inbound_emails").select("id").eq("lead_id", leadId).eq("status", "new");
  const ids = (data ?? []).map((fila) => fila.id);
  if (!ids.length) return;
  await createAdminClient()
    .from("inbound_emails")
    .update({ status: "converted", converted_by: actor, converted_at: new Date().toISOString() })
    .in("id", ids);
}

export async function responderCorreoDeRegistro(formData: FormData) {
  const profile = await requireProfile();
  const leadId = String(formData.get("lead_id") ?? "");
  const correoId = String(formData.get("correo_id") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (texto.length < 2) throw new Error("Escribe la respuesta.");
  if (texto.length > 20000) throw new Error("La respuesta es demasiado larga.");

  const { supabase, correo } = await correoRecibido(leadId, correoId);
  if (!correo.organization_id) throw new Error("El correo no tiene empresa.");
  const buzon = await buzonDeEmpresa(correo.organization_id);
  if (!buzon) throw new Error("La empresa no tiene un buzón conectado para responder.");

  const { data: perfil, error: perfilError } = await supabase
    .from("profiles")
    .select("full_name, email, cargo_comercial, whatsapp_comercial, correo_comercial, firma_comercial")
    .eq("id", profile.id)
    .single();
  if (perfilError || !perfil) throw new Error("No se pudo leer tu firma.");
  const ejecutivo = firmaDesdePerfil({
    nombre: perfil.full_name,
    cargo: perfil.cargo_comercial,
    whatsapp: perfil.whatsapp_comercial,
    correo: perfil.correo_comercial,
    correoAcceso: perfil.email,
    firma: perfil.firma_comercial,
  });

  const asunto = asuntoDeRespuesta(correo.subject);
  const admin = createAdminClient();
  const { data: registro, error: registroError } = await admin
    .from("correos_de_registro")
    .insert({
      organization_id: correo.organization_id,
      lead_id: leadId,
      respuesta_a: correo.id,
      agent_id: profile.id,
      remitente: buzon.address,
      destinatario: correo.from_address,
      asunto: asunto.slice(0, 500),
      cuerpo: texto,
      in_reply_to: correo.message_id,
    })
    .select("id")
    .single();
  if (registroError || !registro) throw new Error(registroError?.message ?? "No se pudo registrar la respuesta.");

  try {
    const { messageId } = await enviarCorreo(buzon, {
      para: correo.from_address,
      nombre: correo.from_name,
      asunto,
      texto: respuestaTexto(texto, ejecutivo, buzon.address),
      html: respuestaHtml(texto, ejecutivo, buzon.address),
      remitenteNombre: remitenteDeEjecutivo(ejecutivo.nombre),
      copiaOculta: COPIA_OCULTA_EQUIFAX,
      inReplyTo: correo.message_id,
    });
    await admin.from("correos_de_registro").update({ estado: "enviado", message_id: messageId, enviado_at: new Date().toISOString() }).eq("id", registro.id);
  } catch (error) {
    const detalle = error instanceof Error && error.message ? error.message : "El servidor de correo no aceptó el mensaje.";
    await admin.from("correos_de_registro").update({ estado: "fallido", error: detalle.slice(0, 800) }).eq("id", registro.id);
    revalidatePath(`/dashboard/leads/${leadId}`);
    throw new Error(`No salió la respuesta: ${detalle}`);
  }

  await atenderPendientes(supabase, leadId, profile.id);
  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}

/** Atendida sin contestar por correo (p. ej. se resolvió por teléfono). */
export async function marcarCorreoAtendido(formData: FormData) {
  const profile = await requireProfile();
  const leadId = String(formData.get("lead_id") ?? "");
  const { supabase } = await correoRecibido(leadId, String(formData.get("correo_id") ?? ""));
  await atenderPendientes(supabase, leadId, profile.id);
  revalidatePath(`/dashboard/leads/${leadId}`);
  revalidatePath("/dashboard/leads");
}
