"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { whatsappGraphApiVersion } from "@/lib/whatsapp";

const MAX_TEXT_LENGTH = 4096;

function revalidateWhatsApp(conversationId?: string) {
  revalidatePath("/dashboard/conversaciones");
  if (conversationId) revalidatePath(`/dashboard/conversaciones?conversation=${conversationId}`);
}

export async function sendWhatsAppMessage(formData: FormData) {
  const profile = await requireProfile();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!conversationId) throw new Error("No se identificó la conversación.");
  if (!body) throw new Error("Escribe un mensaje.");
  if (body.length > MAX_TEXT_LENGTH) throw new Error("El mensaje supera los 4.096 caracteres.");

  // RLS proves that the current operator may see and therefore act on the
  // conversation. Provider writes are then performed with the server client.
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id, channel_id, contact_wa_id")
    .eq("id", conversationId)
    .single();
  if (conversationError || !conversation) throw new Error("No tienes acceso a esta conversación.");

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Falta completar el acceso de Meta para enviar desde Atlas.");

  const admin = createAdminClient();
  const { data: channel, error: channelError } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, status")
    .eq("id", conversation.channel_id)
    .single();
  if (channelError || !channel) throw new Error("El canal de WhatsApp no está configurado.");
  if (channel.status !== "active") throw new Error("El canal de WhatsApp todavía no está conectado.");

  const { data: pendingMessage, error: pendingError } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      message_type: "text",
      text_body: body,
      status: "pending",
      sent_by: profile.id,
      provider_payload: { client_reference: randomUUID() },
    })
    .select("id")
    .single();
  if (pendingError || !pendingMessage) throw new Error("No se pudo preparar el mensaje.");

  try {
    const response = await fetch(
      `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(channel.phone_number_id)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: conversation.contact_wa_id,
          type: "text",
          text: { preview_url: false, body },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number };
    };
    const providerMessageId = payload.messages?.[0]?.id;
    if (!response.ok || !providerMessageId) {
      throw new Error(payload.error?.message || `Meta rechazó el mensaje (${response.status}).`);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("whatsapp_messages")
      .update({
        provider_message_id: providerMessageId,
        status: "accepted",
        provider_timestamp: now,
        provider_payload: payload,
      })
      .eq("id", pendingMessage.id);
    if (updateError) throw updateError;

    await admin
      .from("whatsapp_conversations")
      .update({ last_message_at: now, last_outbound_at: now, status: "open" })
      .eq("id", conversationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta no aceptó el mensaje.";
    await admin
      .from("whatsapp_messages")
      .update({ status: "failed", error_message: message.slice(0, 800) })
      .eq("id", pendingMessage.id);
    throw new Error(message);
  }

  revalidateWhatsApp(conversationId);
}

export async function markWhatsAppConversationRead(formData: FormData) {
  await requireProfile();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) throw new Error("No tienes acceso a esta conversación.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("whatsapp_conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
  revalidateWhatsApp(conversationId);
}

export async function setWhatsAppConversationStatus(formData: FormData) {
  await requireProfile();
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!(["open", "pending", "closed"] as const).includes(status as "open" | "pending" | "closed")) {
    throw new Error("Estado de conversación inválido.");
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) throw new Error("No tienes acceso a esta conversación.");

  const admin = createAdminClient();
  const { error } = await admin.from("whatsapp_conversations").update({ status }).eq("id", conversationId);
  if (error) throw new Error(error.message);
  revalidateWhatsApp(conversationId);
}

export async function assignWhatsAppConversation(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const agentId = String(formData.get("agent_id") ?? "").trim() || null;
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, lead_id, campaign_id")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) throw new Error("No tienes acceso a esta conversación.");

  if (agentId) {
    const { data: membership } = await supabase
      .from("campaign_agents")
      .select("profile_id, profiles!inner(active, role)")
      .eq("campaign_id", conversation.campaign_id)
      .eq("profile_id", agentId)
      .eq("profiles.active", true)
      .eq("profiles.role", "agente")
      .maybeSingle();
    if (!membership) throw new Error("El ejecutivo no pertenece a esta campaña.");
  }

  const { error: assignmentError } = await supabase.rpc("assign_lead", {
    p_lead_id: conversation.lead_id,
    p_agent_id: agentId,
    p_reason: agentId ? "Asignación desde bandeja WhatsApp" : "Desasignación desde bandeja WhatsApp",
    p_source: "whatsapp.inbox",
    p_set_managed_by: false,
    p_next_action_at: null,
  });
  if (assignmentError) throw new Error(assignmentError.message);

  const admin = createAdminClient();
  const { error: conversationUpdateError } = await admin
    .from("whatsapp_conversations")
    .update({ assigned_to: agentId })
    .eq("id", conversationId);
  if (conversationUpdateError) throw new Error(conversationUpdateError.message);

  revalidateWhatsApp(conversationId);
  revalidatePath(`/dashboard/leads/${conversation.lead_id}`);
  revalidatePath("/dashboard/leads");
}

export async function saveWhatsAppChannelConfig(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const wabaId = String(formData.get("waba_id") ?? "").trim();
  const phoneNumberId = String(formData.get("phone_number_id") ?? "").trim();
  const displayPhoneNumber = String(formData.get("display_phone_number") ?? "").trim();
  const businessName = String(formData.get("business_name") ?? "").trim();
  const metaBusinessId = String(formData.get("meta_business_id") ?? "").trim() || null;
  const metaAdAccountId = String(formData.get("meta_ad_account_id") ?? "").trim() || null;
  const campaignId = String(formData.get("campaign_id") ?? "").trim();

  if (![wabaId, phoneNumberId, displayPhoneNumber, businessName, campaignId].every(Boolean)) {
    throw new Error("Completa el número, la cuenta de WhatsApp y la campaña.");
  }
  if (!/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) {
    throw new Error("Los identificadores de Meta deben ser numéricos.");
  }

  const admin = createAdminClient();
  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("id, is_active")
    .eq("id", campaignId)
    .single();
  if (campaignError || !campaign?.is_active) throw new Error("Selecciona una campaña activa.");

  const status = process.env.WHATSAPP_ACCESS_TOKEN
    && process.env.WHATSAPP_META_APP_SECRET
    && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ? "active"
    : "pending";
  const { data: channel, error: channelError } = await admin
    .from("whatsapp_channels")
    .upsert(
      {
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: displayPhoneNumber,
        business_name: businessName,
        meta_business_id: metaBusinessId,
        meta_ad_account_id: metaAdAccountId,
        status,
        created_by: profile.id,
        updated_by: profile.id,
      },
      { onConflict: "phone_number_id" },
    )
    .select("id")
    .single();
  if (channelError || !channel) throw new Error(channelError?.message ?? "No se pudo guardar el canal.");

  const { data: defaultRoute, error: routeReadError } = await admin
    .from("whatsapp_campaign_routes")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("is_default", true)
    .maybeSingle();
  if (routeReadError) throw new Error(routeReadError.message);

  const routePayload = {
    channel_id: channel.id,
    campaign_id: campaignId,
    is_default: true,
    is_active: true,
    created_by: profile.id,
  };
  const routeResult = defaultRoute
    ? await admin.from("whatsapp_campaign_routes").update(routePayload).eq("id", defaultRoute.id)
    : await admin.from("whatsapp_campaign_routes").insert(routePayload);
  if (routeResult.error) throw new Error(routeResult.error.message);

  revalidatePath("/dashboard/admin/integraciones/whatsapp");
  revalidatePath("/dashboard/conversaciones");
}
