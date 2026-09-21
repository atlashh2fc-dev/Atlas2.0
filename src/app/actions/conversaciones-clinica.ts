"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { enviarAFicha } from "@/lib/mensajes/despachar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Responder desde la bandeja de la clínica. La conversación se lee con la
 * sesión de quien responde (la seguridad por fila decide la empresa y el
 * permiso) y el envío sale por el canal de la empresa, en el mismo hilo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function responderConversacion(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const cuerpo = String(formData.get("cuerpo") ?? "").trim().slice(0, 4096);
  if (!UUID.test(conversationId)) throw new Error("No se identificó la conversación.");
  if (cuerpo.length < 1) throw new Error("Escribe un mensaje.");

  const supabase = await createClient();
  const { data: conversacion, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, organization_id, company_id, contact_phone")
    .eq("id", conversationId)
    .single();
  if (error || !conversacion) throw new Error("No tienes acceso a esta conversación.");
  if (!conversacion.company_id || !conversacion.organization_id) throw new Error("Esta conversación no es de una ficha de la clínica.");

  const envio = await enviarAFicha(createAdminClient(), {
    organizationId: conversacion.organization_id as string,
    cuentaId: conversacion.company_id as string,
    destinatario: conversacion.contact_phone as string,
    cuerpo,
    sentBy: profile.id,
    origen: { origen: "bandeja_clinica" },
  });
  if (envio.estado === "fallido") throw new Error(envio.error);
  revalidatePath("/dashboard/mensajes");
}

export async function marcarConversacionLeida(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  if (!UUID.test(conversationId)) throw new Error("No se identificó la conversación.");
  const supabase = await createClient();
  const { data: conversacion } = await supabase.from("whatsapp_conversations").select("id, company_id").eq("id", conversationId).maybeSingle();
  if (!conversacion?.company_id) throw new Error("No tienes acceso a esta conversación.");
  await createAdminClient().from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", conversationId);
  revalidatePath("/dashboard/mensajes");
}
