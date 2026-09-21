import { randomUUID } from "node:crypto";

import { renderizarPlantilla } from "@/lib/mensajes/plantillas";
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
  plantilla: string;
  variables: Record<string, unknown>;
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

async function despacharWhatsApp(admin: ReturnType<typeof createAdminClient>, mensaje: Mensaje, cuerpo: string, resultado: Resultado) {
  const [{ data: canal }, { data: organizacion }] = await Promise.all([
    admin.from("whatsapp_channels").select("id, phone_number_id, display_phone_number, status").eq("organization_id", mensaje.organization_id).order("created_at").limit(1).maybeSingle(),
    admin.from("organizations").select("slug").eq("id", mensaje.organization_id).single(),
  ]);
  const esDemo = typeof organizacion?.slug === "string" && organizacion.slug.startsWith("demo-");
  const canalListo = canal?.status === "active" && isWhatsAppProviderConfigured();

  if (!canalListo) {
    if (esDemo) {
      await cerrar(admin, mensaje.id, "entregado", { cuerpo, proveedor: "simulado", proveedorId: `simulado-${randomUUID()}` });
      resultado.simulados += 1;
      return;
    }
    await cerrar(admin, mensaje.id, "fallido", {
      cuerpo,
      error: canal ? "El canal de WhatsApp de la empresa no está conectado. Actívalo en Integraciones." : "La empresa no tiene un canal de WhatsApp. Configúralo en Integraciones.",
    });
    resultado.fallidos += 1;
    return;
  }

  // Si ya hay conversación con este número, el mensaje queda en ella y la
  // respuesta cae en Conversaciones. Si no, sale igual y la conversación
  // nace cuando la persona contesta.
  const waId = normalizeWhatsAppPhone(mensaje.destinatario).replace(/^\+/, "");
  const { data: conversacion } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("channel_id", canal.id)
    .eq("contact_wa_id", waId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const clientReference = randomUUID();
  let whatsappMessageId: string | undefined;
  if (conversacion) {
    const { data: pendiente } = await admin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversacion.id,
        direction: "outbound",
        message_type: "text",
        text_body: cuerpo,
        status: "pending",
        provider_payload: { provider: whatsappProvider(), client_reference: clientReference, origen: "mensajes_salientes", mensaje_id: mensaje.id },
      })
      .select("id")
      .single();
    whatsappMessageId = pendiente?.id as string | undefined;
  }

  try {
    const { provider, providerMessageId, payload } = await sendWhatsAppText({
      phoneNumberId: canal.phone_number_id,
      from: canal.display_phone_number,
      to: normalizeWhatsAppPhone(mensaje.destinatario),
      body: cuerpo,
      clientReference,
    });
    const ahora = new Date().toISOString();
    if (whatsappMessageId) {
      await admin
        .from("whatsapp_messages")
        .update({ provider_message_id: providerMessageId, status: "accepted", provider_timestamp: ahora, provider_payload: { provider, client_reference: clientReference, response: payload } })
        .eq("id", whatsappMessageId);
      await admin.from("whatsapp_conversations").update({ last_message_at: ahora, last_outbound_at: ahora }).eq("id", conversacion!.id);
    }
    await cerrar(admin, mensaje.id, "enviado", { cuerpo, proveedor: provider, proveedorId: providerMessageId, conversation: conversacion?.id, whatsappMessage: whatsappMessageId });
    resultado.enviados += 1;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "El proveedor de WhatsApp no aceptó el mensaje.";
    if (whatsappMessageId) {
      await admin.from("whatsapp_messages").update({ status: "failed", error_message: detalle.slice(0, 800) }).eq("id", whatsappMessageId);
    }
    await cerrar(admin, mensaje.id, "fallido", { cuerpo, error: detalle, conversation: conversacion?.id, whatsappMessage: whatsappMessageId });
    resultado.fallidos += 1;
  }
}

/** Genera lo que toca hoy y despacha lo que está programado. */
export async function despacharMensajes(opciones: { generar?: boolean; limite?: number } = {}): Promise<Resultado & { generados: Record<string, number> }> {
  const admin = createAdminClient();
  let generados: Record<string, number> = {};
  if (opciones.generar !== false) {
    const { data, error } = await admin.rpc("generar_recordatorios");
    if (error) console.error("[mensajes] no se pudieron generar los recordatorios", error.message);
    else generados = (data as Record<string, number>) ?? {};
  }

  const { data: reclamados, error } = await admin.rpc("reclamar_mensajes_salientes", { p_limite: opciones.limite ?? 50 });
  if (error) throw new Error(error.message);
  const resultado: Resultado = { enviados: 0, simulados: 0, fallidos: 0 };

  for (const fila of (reclamados ?? []) as Mensaje[]) {
    const cuerpo = renderizarPlantilla(fila.plantilla, fila.variables ?? {});
    if (fila.canal !== "whatsapp") {
      await cerrar(admin, fila.id, "fallido", { cuerpo, error: `El canal ${fila.canal} todavía no está conectado a Atlas.` });
      resultado.fallidos += 1;
      continue;
    }
    await despacharWhatsApp(admin, fila, cuerpo, resultado);
  }
  return { ...resultado, generados };
}
