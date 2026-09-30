import type { MensajeSocial } from "@/lib/mensajeria-social";
import { perfilDelContacto } from "@/lib/meta-mensajeria";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeWhatsAppPhone, type ParsedWhatsAppEvent, type ParsedWhatsAppMessage } from "@/lib/whatsapp";

type AdminClient = ReturnType<typeof createAdminClient>;

export type WhatsAppWebhookResult = {
  processed: number;
  duplicates: number;
  unmapped: number;
  failed: number;
  aiCandidates: Array<{ conversationId: string; inboundMessageId: string }>;
  mediaCandidates: Array<{ messageId: string }>;
};

async function campaignForEvent(
  admin: AdminClient,
  channelId: string,
  event: Extract<ParsedWhatsAppEvent, { kind: "message" }>,
) {
  if (event.referral.source_id) {
    const { data: exactRoute, error } = await admin
      .from("whatsapp_campaign_routes")
      .select("campaign_id")
      .eq("channel_id", channelId)
      .eq("meta_ad_id", event.referral.source_id)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (exactRoute) return exactRoute.campaign_id as string;
  }

  // Only the first message opened from a click-to-WhatsApp ad is guaranteed
  // to carry referral metadata. Follow-up messages stay in the most recently
  // active commercial thread for this contact instead of falling back to an
  // unrelated default campaign.
  const { data: activeConversation, error: activeConversationError } = await admin
    .from("whatsapp_conversations")
    .select("campaign_id")
    .eq("channel_id", channelId)
    .eq("contact_wa_id", event.contactWaId)
    .in("status", ["open", "pending"])
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeConversationError) throw activeConversationError;
  if (activeConversation) return activeConversation.campaign_id as string;

  const { data: defaultRoute, error } = await admin
    .from("whatsapp_campaign_routes")
    .select("campaign_id")
    .eq("channel_id", channelId)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (defaultRoute?.campaign_id as string | undefined) ?? null;
}

/** La empresa del canal, si es una clínica (Dental o Vet). */
async function clinicaDelCanal(admin: AdminClient, organizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  const { data } = await admin.from("organizations").select("id, edicion").eq("id", organizationId).maybeSingle();
  return data && (data.edicion === "vet" || data.edicion === "dental") ? (data.id as string) : null;
}

async function channelForEvent(admin: AdminClient, event: ParsedWhatsAppEvent) {
  const { data: phoneIdChannel, error: phoneIdError } = await admin
    .from("whatsapp_channels")
    .select("id, status, organization_id")
    .eq("phone_number_id", event.phoneNumberId)
    .maybeSingle();
  if (phoneIdError) throw phoneIdError;
  if (phoneIdChannel) return phoneIdChannel;

  if (event.wabaId) {
    const { data: wabaChannel, error: wabaError } = await admin
      .from("whatsapp_channels")
      .select("id, status, organization_id")
      .eq("waba_id", event.wabaId)
      .maybeSingle();
    if (wabaError) throw wabaError;
    if (wabaChannel) return wabaChannel;
  }

  if (event.businessPhone) {
    const { data: candidates, error } = await admin
      .from("whatsapp_channels")
      .select("id, status, organization_id, display_phone_number")
      .limit(50);
    if (error) throw error;
    const normalized = normalizeWhatsAppPhone(event.businessPhone);
    return (candidates ?? []).find(
      (candidate) => normalizeWhatsAppPhone(candidate.display_phone_number) === normalized,
    ) ?? null;
  }

  return null;
}

/**
 * Si el contacto es un prospecto de campaña, el mensaje queda ligado a él: lo
 * que contesta por WhatsApp lo sube en Por contactar como «Respondió».
 */
async function registrarWhatsAppDeProspecto(admin: AdminClient, organizationId: string, event: ParsedWhatsAppMessage) {
  const { error } = await admin.rpc("registrar_whatsapp_de_prospecto", {
    p_organization_id: organizationId,
    p_telefono: event.contactPhone,
    p_direction: event.direction,
    p_wamid: event.providerMessageId,
    p_texto: event.textBody,
    p_at: event.timestamp,
  });
  if (error) console.error("whatsapp_prospecto_sin_registrar", { code: error.code, message: error.message.slice(0, 200) });
}

async function anotarEnvioDesdeElTelefono(admin: AdminClient, organizationId: string, telefono: string, enviadoAt: string) {
  const { error } = await admin.rpc("anotar_whatsapp_desde_el_telefono", {
    p_organization_id: organizationId,
    p_telefono: telefono,
    p_enviado_at: enviadoAt,
  });
  // Anotar es un extra: si falla, el mensaje igual se guarda en su conversación.
  if (error) console.error("whatsapp_eco_sin_anotar", { code: error.code, message: error.message.slice(0, 200) });
}

async function markWebhookEvent(
  admin: AdminClient,
  id: string,
  status: "processed" | "unmapped" | "failed",
  errorMessage?: string,
) {
  await admin
    .from("whatsapp_webhook_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage?.slice(0, 800) ?? null,
    })
    .eq("id", id);
}

export async function processWhatsAppEvents(
  events: ParsedWhatsAppEvent[],
  provider: "meta" | "ycloud",
): Promise<WhatsAppWebhookResult> {
  const admin = createAdminClient();
  const result: WhatsAppWebhookResult = {
    processed: 0,
    duplicates: 0,
    unmapped: 0,
    failed: 0,
    aiCandidates: [],
    mediaCandidates: [],
  };

  for (const event of events) {
    const { data: storedEvent, error: storeError } = await admin
      .from("whatsapp_webhook_events")
      .insert({
        provider_event_key: event.eventKey,
        event_type: event.kind,
        phone_number_id: event.phoneNumberId,
        payload: { ...event.payload, provider },
      })
      .select("id")
      .single();

    if (storeError?.code === "23505") {
      result.duplicates += 1;
      continue;
    }
    if (storeError || !storedEvent) {
      result.failed += 1;
      console.error("whatsapp_webhook_event_store_failed", { provider, code: storeError?.code });
      continue;
    }

    try {
      if (event.kind === "status") {
        if (event.externalId) {
          const { data: correlated, error: correlationError } = await admin
            .from("whatsapp_messages")
            .select("id, provider_message_id")
            .contains("provider_payload", { client_reference: event.externalId })
            .maybeSingle();
          if (correlationError) throw correlationError;
          if (correlated && correlated.provider_message_id !== event.providerMessageId) {
            const { error: providerIdError } = await admin
              .from("whatsapp_messages")
              .update({ provider_message_id: event.providerMessageId })
              .eq("id", correlated.id);
            if (providerIdError) throw providerIdError;
          }
        }
        const { error: statusError } = await admin.rpc("update_whatsapp_message_status", {
          p_provider_message_id: event.providerMessageId,
          p_status: event.status,
          p_provider_timestamp: event.timestamp,
          p_error_message: event.errorMessage,
          p_payload: event.payload,
        });
        if (statusError) throw statusError;
        await markWebhookEvent(admin, storedEvent.id, "processed");
        result.processed += 1;
        continue;
      }

      const channel = await channelForEvent(admin, event);
      if (!channel || channel.status === "paused") {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "Número sin canal operativo en Atlas.");
        result.unmapped += 1;
        continue;
      }

      // Un mensaje saliente que llega por el webhook se escribió fuera de Atlas:
      // desde la app WhatsApp Business del teléfono. Si va a alguien de Por
      // contactar, queda anotado como «Le escribí» sin que nadie lo marque.
      if (channel.organization_id) {
        await registrarWhatsAppDeProspecto(admin, channel.organization_id as string, event);
        if (event.direction === "outbound") {
          await anotarEnvioDesdeElTelefono(admin, channel.organization_id as string, event.contactPhone, event.timestamp);
        }
      }

      const campaignId = await campaignForEvent(admin, channel.id, event);
      if (!campaignId) {
        // Sin campaña no hay call center: si la empresa es una clínica, el
        // mensaje va a la ficha del tutor o paciente (o abre una nueva).
        const clinica = await clinicaDelCanal(admin, channel.organization_id as string | null);
        if (!clinica) {
          await markWebhookEvent(admin, storedEvent.id, "unmapped", "El canal no tiene una ruta de campaña activa.");
          result.unmapped += 1;
          continue;
        }
        const { data: ingestado, error: ingestaError } = await admin.rpc("ingest_whatsapp_mensaje_de_clinica", {
          p_channel_id: channel.id,
          p_organization_id: clinica,
          p_provider_message_id: event.providerMessageId,
          p_direction: event.direction,
          p_contact_wa_id: event.contactWaId,
          p_contact_phone: event.contactPhone,
          p_contact_name: event.contactName,
          p_message_type: event.messageType,
          p_text_body: event.textBody,
          p_provider_timestamp: event.timestamp,
          p_sender_wa_id: event.senderWaId,
          p_context_provider_message_id: event.contextProviderMessageId,
          p_payload: { ...event.payload, provider },
        });
        if (ingestaError) throw ingestaError;
        const fila = typeof ingestado === "object" && ingestado !== null ? (ingestado as Record<string, unknown>) : {};
        if (fila.duplicate !== true && typeof fila.message_id === "string" && (event.messageType === "image" || event.messageType === "audio")) {
          result.mediaCandidates.push({ messageId: fila.message_id });
        }
        await admin
          .from("whatsapp_channels")
          .update({ status: "active", last_webhook_at: new Date().toISOString(), last_error: null })
          .eq("id", channel.id);
        await markWebhookEvent(admin, storedEvent.id, "processed");
        result.processed += 1;
        continue;
      }

      const { data: ingestData, error: ingestError } = await admin.rpc("ingest_whatsapp_message", {
        p_channel_id: channel.id,
        p_campaign_id: campaignId,
        p_provider_message_id: event.providerMessageId,
        p_direction: event.direction,
        p_contact_wa_id: event.contactWaId,
        p_contact_phone: event.contactPhone,
        p_contact_name: event.contactName,
        p_message_type: event.messageType,
        p_text_body: event.textBody,
        p_provider_timestamp: event.timestamp,
        p_sender_wa_id: event.senderWaId,
        p_context_provider_message_id: event.contextProviderMessageId,
        p_referral: event.referral,
        p_payload: { ...event.payload, provider },
      });
      if (ingestError) throw ingestError;

      const ingested = typeof ingestData === "object" && ingestData !== null
        ? ingestData as Record<string, unknown>
        : {};
      if (
        ingested.duplicate !== true
        && typeof ingested.conversation_id === "string"
        && typeof ingested.message_id === "string"
      ) {
        if (event.direction === "inbound" && event.messageType === "text") {
          result.aiCandidates.push({
            conversationId: ingested.conversation_id,
            inboundMessageId: ingested.message_id,
          });
        }
        if (event.messageType === "image" || event.messageType === "audio") {
          result.mediaCandidates.push({ messageId: ingested.message_id });
        }
      }

      await admin
        .from("whatsapp_channels")
        .update({ status: "active", last_webhook_at: new Date().toISOString(), last_error: null })
        .eq("id", channel.id);
      await markWebhookEvent(admin, storedEvent.id, "processed");
      result.processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo procesar el evento.";
      await markWebhookEvent(admin, storedEvent.id, "failed", message);
      result.failed += 1;
      console.error("whatsapp_webhook_event_failed", {
        provider,
        eventKey: event.eventKey,
        message: message.slice(0, 500),
      });
    }
  }

  return result;
}

/**
 * Instagram y Messenger: el canal se reconoce por la página o la cuenta que
 * recibe el webhook, la campaña por el hilo abierto o la ruta por defecto, y
 * el contacto por su identificador en esa red. Un mensaje de un contacto nuevo
 * pregunta a Meta su nombre de perfil para que el registro no nazca anónimo.
 */
export async function processMensajesSociales(mensajes: MensajeSocial[]): Promise<WhatsAppWebhookResult> {
  const admin = createAdminClient();
  const result: WhatsAppWebhookResult = { processed: 0, duplicates: 0, unmapped: 0, failed: 0, aiCandidates: [], mediaCandidates: [] };

  for (const mensaje of mensajes) {
    const { data: storedEvent, error: storeError } = await admin
      .from("whatsapp_webhook_events")
      .insert({
        provider_event_key: mensaje.eventKey,
        event_type: "message",
        phone_number_id: mensaje.cuentaId,
        payload: { ...mensaje.payload, provider: "meta", canal: mensaje.canal },
      })
      .select("id")
      .single();
    if (storeError?.code === "23505") {
      result.duplicates += 1;
      continue;
    }
    if (storeError || !storedEvent) {
      result.failed += 1;
      console.error("mensajeria_social_evento_sin_guardar", { canal: mensaje.canal, code: storeError?.code });
      continue;
    }

    try {
      const { data: channel, error: channelError } = await admin
        .from("whatsapp_channels")
        .select("id, status")
        .eq("canal", mensaje.canal)
        .eq(mensaje.canal === "instagram" ? "ig_user_id" : "page_id", mensaje.cuentaId)
        .maybeSingle();
      if (channelError) throw channelError;
      if (!channel || channel.status === "paused") {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "Cuenta sin canal operativo en Atlas.");
        result.unmapped += 1;
        continue;
      }

      const { data: hilo, error: hiloError } = await admin
        .from("whatsapp_conversations")
        .select("campaign_id, contact_name")
        .eq("channel_id", channel.id)
        .eq("contact_wa_id", mensaje.contactoId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (hiloError) throw hiloError;

      let campaignId = (hilo?.campaign_id as string | null | undefined) ?? null;
      if (!campaignId) {
        const { data: ruta, error: rutaError } = await admin
          .from("whatsapp_campaign_routes")
          .select("campaign_id")
          .eq("channel_id", channel.id)
          .eq("is_default", true)
          .eq("is_active", true)
          .maybeSingle();
        if (rutaError) throw rutaError;
        campaignId = (ruta?.campaign_id as string | undefined) ?? null;
      }
      if (!campaignId) {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "El canal no tiene una campaña de destino.");
        result.unmapped += 1;
        continue;
      }

      const nombre = hilo?.contact_name ? null : await perfilDelContacto(mensaje.canal, channel.id, mensaje.contactoId);
      const { data: ingestado, error: ingestaError } = await admin.rpc("ingest_mensaje_social", {
        p_channel_id: channel.id,
        p_campaign_id: campaignId,
        p_provider_message_id: mensaje.providerMessageId,
        p_direction: mensaje.direction,
        p_contact_id: mensaje.contactoId,
        p_contact_name: nombre,
        p_message_type: mensaje.messageType,
        p_text_body: mensaje.textBody,
        p_provider_timestamp: mensaje.timestamp,
        p_payload: { ...mensaje.payload, provider: "meta", canal: mensaje.canal, adjunto_url: mensaje.adjuntoUrl },
      });
      if (ingestaError) throw ingestaError;

      const fila = typeof ingestado === "object" && ingestado !== null ? (ingestado as Record<string, unknown>) : {};
      if (
        fila.duplicate !== true
        && mensaje.direction === "inbound"
        && mensaje.messageType === "text"
        && typeof fila.conversation_id === "string"
        && typeof fila.message_id === "string"
      ) {
        result.aiCandidates.push({ conversationId: fila.conversation_id, inboundMessageId: fila.message_id });
      }

      await admin
        .from("whatsapp_channels")
        .update({ status: "active", last_webhook_at: new Date().toISOString(), last_error: null })
        .eq("id", channel.id);
      await markWebhookEvent(admin, storedEvent.id, "processed");
      result.processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo procesar el evento.";
      await markWebhookEvent(admin, storedEvent.id, "failed", message);
      result.failed += 1;
      console.error("mensajeria_social_evento_fallido", { canal: mensaje.canal, eventKey: mensaje.eventKey, message: message.slice(0, 500) });
    }
  }

  return result;
}
