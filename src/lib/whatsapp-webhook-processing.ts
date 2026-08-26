import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeWhatsAppPhone, type ParsedWhatsAppEvent } from "@/lib/whatsapp";

type AdminClient = ReturnType<typeof createAdminClient>;

export type WhatsAppWebhookResult = {
  processed: number;
  duplicates: number;
  unmapped: number;
  failed: number;
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

async function channelForEvent(admin: AdminClient, event: ParsedWhatsAppEvent) {
  const { data: phoneIdChannel, error: phoneIdError } = await admin
    .from("whatsapp_channels")
    .select("id, status")
    .eq("phone_number_id", event.phoneNumberId)
    .maybeSingle();
  if (phoneIdError) throw phoneIdError;
  if (phoneIdChannel) return phoneIdChannel;

  if (event.wabaId) {
    const { data: wabaChannel, error: wabaError } = await admin
      .from("whatsapp_channels")
      .select("id, status")
      .eq("waba_id", event.wabaId)
      .maybeSingle();
    if (wabaError) throw wabaError;
    if (wabaChannel) return wabaChannel;
  }

  if (event.businessPhone) {
    const { data: candidates, error } = await admin
      .from("whatsapp_channels")
      .select("id, status, display_phone_number")
      .limit(50);
    if (error) throw error;
    const normalized = normalizeWhatsAppPhone(event.businessPhone);
    return (candidates ?? []).find(
      (candidate) => normalizeWhatsAppPhone(candidate.display_phone_number) === normalized,
    ) ?? null;
  }

  return null;
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
  const result: WhatsAppWebhookResult = { processed: 0, duplicates: 0, unmapped: 0, failed: 0 };

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

      const campaignId = await campaignForEvent(admin, channel.id, event);
      if (!campaignId) {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "El canal no tiene una ruta de campaña activa.");
        result.unmapped += 1;
        continue;
      }

      const { error: ingestError } = await admin.rpc("ingest_whatsapp_message", {
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
        p_payload: event.payload,
      });
      if (ingestError) throw ingestError;

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
