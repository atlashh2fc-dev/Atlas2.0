import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseWhatsAppWebhook,
  verifyMetaWebhookSignature,
  type ParsedWhatsAppEvent,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const suppliedToken = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expectedToken && suppliedToken === expectedToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({ error: "Verificación rechazada." }, { status: 403 });
}

async function campaignForEvent(
  admin: ReturnType<typeof createAdminClient>,
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

async function markWebhookEvent(
  admin: ReturnType<typeof createAdminClient>,
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

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload demasiado grande." }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length < 1 || rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload inválido." }, { status: rawBody.length ? 413 : 400 });
  }

  const appSecret = process.env.WHATSAPP_META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "Integración no configurada." }, { status: 503 });
  }
  if (!verifyMetaWebhookSignature(appSecret, rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const events = parseWhatsAppWebhook(decoded);
  const admin = createAdminClient();
  let processed = 0;
  let duplicates = 0;
  let unmapped = 0;
  let failed = 0;

  for (const event of events) {
    const { data: storedEvent, error: storeError } = await admin
      .from("whatsapp_webhook_events")
      .insert({
        provider_event_key: event.eventKey,
        event_type: event.kind,
        phone_number_id: event.phoneNumberId,
        payload: event.payload,
      })
      .select("id")
      .single();

    if (storeError?.code === "23505") {
      duplicates += 1;
      continue;
    }
    if (storeError || !storedEvent) {
      failed += 1;
      console.error("whatsapp_webhook_event_store_failed", { code: storeError?.code });
      continue;
    }

    try {
      if (event.kind === "status") {
        const { error: statusError } = await admin.rpc("update_whatsapp_message_status", {
          p_provider_message_id: event.providerMessageId,
          p_status: event.status,
          p_provider_timestamp: event.timestamp,
          p_error_message: event.errorMessage,
          p_payload: event.payload,
        });
        if (statusError) {
          throw statusError;
        }
        await markWebhookEvent(admin, storedEvent.id, "processed");
        processed += 1;
        continue;
      }

      const { data: channel, error: channelError } = await admin
        .from("whatsapp_channels")
        .select("id, status")
        .eq("phone_number_id", event.phoneNumberId)
        .maybeSingle();
      if (channelError) throw channelError;
      if (!channel || channel.status === "paused") {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "Número sin canal operativo en Atlas.");
        unmapped += 1;
        continue;
      }

      const campaignId = await campaignForEvent(admin, channel.id, event);
      if (!campaignId) {
        await markWebhookEvent(admin, storedEvent.id, "unmapped", "El canal no tiene una ruta de campaña activa.");
        unmapped += 1;
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
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo procesar el evento.";
      await markWebhookEvent(admin, storedEvent.id, "failed", message);
      failed += 1;
      console.error("whatsapp_webhook_event_failed", {
        eventKey: event.eventKey,
        message: message.slice(0, 500),
      });
    }
  }

  // Meta only needs an acknowledgement. Per-event diagnostics remain private
  // in whatsapp_webhook_events and never expose customer data in the response.
  return NextResponse.json({ acknowledged: true, processed, duplicates, unmapped, failed });
}
