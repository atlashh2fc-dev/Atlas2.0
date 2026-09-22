import { randomUUID } from "node:crypto";

import { buzonDeEmpresa } from "@/lib/correo/buzon";
import { enviarCorreo } from "@/lib/correo/smtp";
import { PLANTILLAS, renderizarPlantilla, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";
import { isWhatsAppProviderConfigured, sendWhatsAppText, whatsappProvider } from "@/lib/whatsapp-provider";

/**
 * El despacho: toma lo que toca enviar y lo manda por el canal de la empresa.
 *
 * Corre sin sesión (desde el cron o justo después de que alguien pide
 * "enviar ahora"), así que va con la clave de servicio y solo toca mensajes
 * que la base ya reclamó. Si la empresa es de demostración y su canal no
 * está conectado, el envío se simula y queda marcado como tal: la demo
 * muestra el flujo completo sin fingir que salió un WhatsApp real.
 */

type Mensaje = {
  id: string;
  organization_id: string;
  canal: string;
  cuenta_id: string | null;
  destinatario: string;
  nombre_destinatario: string | null;
  plantilla: string;
  variables: Record<string, unknown>;
  asunto: string | null;
  in_reply_to: string | null;
};

type Resultado = { enviados: number; simulados: number; fallidos: number };

async function cerrar(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  estado: "enviado" | "entregado" | "fallido",
  extra: { cuerpo?: string; proveedor?: string; proveedorId?: string; error?: string; conversation?: string; whatsappMessage?: string } = {},
) {
  const { error } = await admin.rpc("cerrar_mensaje_saliente", {
    p_id: id,
    p_estado: estado,
    p_cuerpo: extra.cuerpo ?? null,
    p_proveedor: extra.proveedor ?? null,
    p_proveedor_id: extra.proveedorId ?? null,
    p_error: extra.error ?? null,
    p_conversation: extra.conversation ?? null,
    p_whatsapp_message: extra.whatsappMessage ?? null,
  });
  if (error) console.error("[mensajes] no se pudo cerrar el mensaje", id, error.message);
}

type Admin = ReturnType<typeof createAdminClient>;

export type EnvioAConversacion =
  | { estado: "enviado"; proveedor: string; proveedorId: string; conversationId: string; whatsappMessageId: string }
  | { estado: "simulado"; proveedor: "simulado"; proveedorId: string; conversationId: string; whatsappMessageId: string }
  | { estado: "fallido"; error: string; conversationId: string | null; whatsappMessageId: string | null };

/**
 * Manda un texto a una ficha por el WhatsApp de su empresa y lo deja en el
 * hilo de la conversación. Lo usan el despacho de recordatorios y la bandeja
 * de la clínica. Si la empresa es de demostración y su canal no está
 * conectado, el envío se simula y queda marcado como tal.
 */
export async function enviarAFicha(admin: Admin, entrada: { organizationId: string; cuentaId: string; destinatario: string; cuerpo: string; sentBy?: string | null; origen?: Record<string, unknown> }): Promise<EnvioAConversacion> {
  const [{ data: canal }, { data: organizacion }] = await Promise.all([
    admin.from("whatsapp_channels").select("id, phone_number_id, display_phone_number, status").eq("organization_id", entrada.organizationId).order("created_at").limit(1).maybeSingle(),
    admin.from("organizations").select("slug").eq("id", entrada.organizationId).single(),
  ]);
  const esDemo = typeof organizacion?.slug === "string" && organizacion.slug.startsWith("demo-");
  if (!canal) {
    return { estado: "fallido", error: "La empresa no tiene un canal de WhatsApp. Configúralo en Integraciones.", conversationId: null, whatsappMessageId: null };
  }
  const canalListo = canal.status === "active" && isWhatsAppProviderConfigured();
  if (!canalListo && !esDemo) {
    return { estado: "fallido", error: "El canal de WhatsApp de la empresa no está conectado. Actívalo en Integraciones.", conversationId: null, whatsappMessageId: null };
  }

  const { data: conversationId, error: conversacionError } = await admin.rpc("abrir_conversacion_de_clinica", { p_channel_id: canal.id, p_cuenta: entrada.cuentaId });
  if (conversacionError || typeof conversationId !== "string") {
    return { estado: "fallido", error: conversacionError?.message ?? "No se pudo abrir la conversación.", conversationId: null, whatsappMessageId: null };
  }

  const clientReference = randomUUID();
  const ahora = new Date().toISOString();
  const { data: pendiente, error: pendienteError } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      message_type: "text",
      text_body: entrada.cuerpo,
      status: "pending",
      sent_by: entrada.sentBy ?? null,
      provider_payload: { provider: canalListo ? whatsappProvider() : "simulado", client_reference: clientReference, ...(entrada.origen ?? {}) },
    })
    .select("id")
    .single();
  if (pendienteError || !pendiente) {
    return { estado: "fallido", error: pendienteError?.message ?? "No se pudo preparar el mensaje.", conversationId, whatsappMessageId: null };
  }
  const whatsappMessageId = pendiente.id as string;

  if (!canalListo) {
    const proveedorId = `simulado-${clientReference}`;
    await admin.from("whatsapp_messages").update({ provider_message_id: proveedorId, status: "delivered", provider_timestamp: ahora }).eq("id", whatsappMessageId);
    await admin.from("whatsapp_conversations").update({ last_message_at: ahora, last_outbound_at: ahora, status: "open" }).eq("id", conversationId);
    return { estado: "simulado", proveedor: "simulado", proveedorId, conversationId, whatsappMessageId };
  }

  try {
    const { provider, providerMessageId, payload } = await sendWhatsAppText({
      phoneNumberId: canal.phone_number_id,
      from: canal.display_phone_number,
      to: normalizeWhatsAppPhone(entrada.destinatario),
      body: entrada.cuerpo,
      clientReference,
    });
    await admin
      .from("whatsapp_messages")
      .update({ provider_message_id: providerMessageId, status: "accepted", provider_timestamp: ahora, provider_payload: { provider, client_reference: clientReference, response: payload, ...(entrada.origen ?? {}) } })
      .eq("id", whatsappMessageId);
    await admin.from("whatsapp_conversations").update({ last_message_at: ahora, last_outbound_at: ahora, status: "open" }).eq("id", conversationId);
    return { estado: "enviado", proveedor: provider, proveedorId: providerMessageId, conversationId, whatsappMessageId };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "El proveedor de WhatsApp no aceptó el mensaje.";
    await admin.from("whatsapp_messages").update({ status: "failed", error_message: detalle.slice(0, 800) }).eq("id", whatsappMessageId);
    return { estado: "fallido", error: detalle, conversationId, whatsappMessageId };
  }
}


export type EnvioDeCorreo =
  | { estado: "enviado"; proveedor: "smtp"; proveedorId: string }
  | { estado: "encolado"; proveedor: "atlas_lead"; proveedorId: string }
  | { estado: "simulado"; proveedor: "simulado"; proveedorId: string }
  | { estado: "fallido"; error: string };

/** Atlas Lead está conectado como destino del puente y activo. */
async function atlasLeadDisponible(admin: Admin): Promise<boolean> {
  const { data } = await admin.from("integration_sources").select("id").eq("code", "atlas_lead").eq("is_active", true).maybeSingle();
  return Boolean(data) && (process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON ?? "").includes("atlas_lead");
}

/**
 * Manda un correo de una clínica. Primero por el puente con Atlas Lead, que
 * ya sabe enviar por SES a pedido del CRM; si el puente no está, por el
 * buzón propio de la clínica; en una empresa de demostración sin ninguno
 * de los dos, se simula y queda marcado así.
 */
export async function enviarCorreoAFicha(admin: Admin, entrada: { organizationId: string; para: string; nombre?: string | null; asunto: string; texto: string; inReplyTo?: string | null; mensajeId?: string }): Promise<EnvioDeCorreo> {
  const [{ data: organizacion }, puente] = await Promise.all([
    admin.from("organizations").select("slug").eq("id", entrada.organizationId).single(),
    atlasLeadDisponible(admin),
  ]);
  const esDemo = typeof organizacion?.slug === "string" && organizacion.slug.startsWith("demo-");

  if (puente && entrada.mensajeId && !esDemo) {
    const { data, error } = await admin.rpc("encolar_correo_en_atlas_lead", { p_mensaje: entrada.mensajeId });
    if (!error && typeof data === "string") return { estado: "encolado", proveedor: "atlas_lead", proveedorId: data };
    console.error("[correo] no se pudo encolar en Atlas Lead, se intenta el buzón propio", error?.message);
  }

  const buzon = await buzonDeEmpresa(entrada.organizationId);
  if (!buzon) {
    if (esDemo) return { estado: "simulado", proveedor: "simulado", proveedorId: `simulado-${randomUUID()}` };
    return { estado: "fallido", error: "No hay por dónde mandar el correo: conecta el puente con Atlas Lead o el buzón de la clínica." };
  }
  try {
    const { messageId } = await enviarCorreo(buzon, { para: entrada.para, nombre: entrada.nombre, asunto: entrada.asunto, texto: entrada.texto, inReplyTo: entrada.inReplyTo });
    return { estado: "enviado", proveedor: "smtp", proveedorId: messageId };
  } catch (error) {
    return { estado: "fallido", error: error instanceof Error ? error.message : "El servidor de correo no aceptó el mensaje." };
  }
}

async function despacharCorreo(admin: Admin, mensaje: Mensaje, cuerpo: string, resultado: Resultado) {
  const asunto = mensaje.asunto ?? (PLANTILLAS[mensaje.plantilla as ClavePlantilla]?.nombre ?? "Mensaje de la clínica");
  // El cuerpo y el asunto quedan escritos antes de encolar: el puente los lee de la fila.
  await admin.from("mensajes_salientes").update({ cuerpo, asunto, updated_at: new Date().toISOString() }).eq("id", mensaje.id);
  const envio = await enviarCorreoAFicha(admin, { organizationId: mensaje.organization_id, para: mensaje.destinatario, nombre: mensaje.nombre_destinatario, asunto, texto: cuerpo, inReplyTo: mensaje.in_reply_to, mensajeId: mensaje.id });
  if (envio.estado === "fallido") {
    await cerrar(admin, mensaje.id, "fallido", { cuerpo, error: envio.error });
    resultado.fallidos += 1;
    return;
  }
  if (envio.estado === "encolado") {
    // Queda "enviando" hasta que el puente acuse; el trigger lo cierra.
    resultado.enviados += 1;
    return;
  }
  await cerrar(admin, mensaje.id, envio.estado === "simulado" ? "entregado" : "enviado", { cuerpo, proveedor: envio.proveedor, proveedorId: envio.proveedorId });
  if (envio.estado === "simulado") resultado.simulados += 1;
  else resultado.enviados += 1;
}

async function despacharWhatsApp(admin: Admin, mensaje: Mensaje, cuerpo: string, resultado: Resultado) {
  if (!mensaje.cuenta_id) {
    await cerrar(admin, mensaje.id, "fallido", { cuerpo, error: "El mensaje no tiene ficha de destino." });
    resultado.fallidos += 1;
    return;
  }
  const envio = await enviarAFicha(admin, {
    organizationId: mensaje.organization_id,
    cuentaId: mensaje.cuenta_id,
    destinatario: mensaje.destinatario,
    cuerpo,
    origen: { origen: "mensajes_salientes", mensaje_id: mensaje.id },
  });
  if (envio.estado === "fallido") {
    await cerrar(admin, mensaje.id, "fallido", { cuerpo, error: envio.error, conversation: envio.conversationId ?? undefined, whatsappMessage: envio.whatsappMessageId ?? undefined });
    resultado.fallidos += 1;
    return;
  }
  await cerrar(admin, mensaje.id, envio.estado === "simulado" ? "entregado" : "enviado", {
    cuerpo,
    proveedor: envio.proveedor,
    proveedorId: envio.proveedorId,
    conversation: envio.conversationId,
    whatsappMessage: envio.whatsappMessageId,
  });
  if (envio.estado === "simulado") resultado.simulados += 1;
  else resultado.enviados += 1;
}

/** Genera lo que toca hoy y despacha lo que está programado. */
export async function despacharMensajes(opciones: { generar?: boolean; limite?: number } = {}): Promise<Resultado & { generados: Record<string, number> }> {
  const admin = createAdminClient();
  let generados: Record<string, number> = {};
  if (opciones.generar !== false) {
    const { data, error } = await admin.rpc("generar_recordatorios");
    if (error) console.error("[mensajes] no se pudieron generar los recordatorios", error.message);
    else generados = (data as Record<string, number>) ?? {};
    const { data: seguimientos, error: seguimientosError } = await admin.rpc("generar_seguimientos_b2b");
    if (seguimientosError) console.error("[mensajes] no se pudieron generar los seguimientos", seguimientosError.message);
    else generados = { ...generados, seguimientos: Number(seguimientos ?? 0) };
  }

  const { data: reclamados, error } = await admin.rpc("reclamar_mensajes_salientes", { p_limite: opciones.limite ?? 50 });
  if (error) throw new Error(error.message);
  const resultado: Resultado = { enviados: 0, simulados: 0, fallidos: 0 };

  for (const fila of (reclamados ?? []) as Mensaje[]) {
    const cuerpo = renderizarPlantilla(fila.plantilla, fila.variables ?? {});
    if (fila.canal === "correo") {
      await despacharCorreo(admin, fila, cuerpo, resultado);
      continue;
    }
    if (fila.canal !== "whatsapp") {
      await cerrar(admin, fila.id, "fallido", { cuerpo, error: `El canal ${fila.canal} todavía no está conectado a Atlas.` });
      resultado.fallidos += 1;
      continue;
    }
    await despacharWhatsApp(admin, fila, cuerpo, resultado);
  }
  return { ...resultado, generados };
}
