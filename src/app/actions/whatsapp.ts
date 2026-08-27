"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertCanOperateAssignedConversation } from "@/lib/workspace-permissions";
import {
  WHATSAPP_MEDIA_BUCKET,
  validateWhatsAppMedia,
} from "@/lib/whatsapp-media";
import {
  isWhatsAppProviderConfigured,
  sendWhatsAppMedia,
  sendWhatsAppText,
  whatsappProvider,
} from "@/lib/whatsapp-provider";

const MAX_TEXT_LENGTH = 4096;
const MAX_MEDIA_CAPTION_LENGTH = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidateWhatsApp(conversationId?: string) {
  revalidatePath("/dashboard/conversaciones");
  if (conversationId) revalidatePath(`/dashboard/conversaciones?conversation=${conversationId}`);
}

async function assertHumanAttentionAllowed(conversation: { campaign_id: string; ai_state: string }) {
  const admin = createAdminClient();
  const { data: config, error } = await admin.from("whatsapp_ai_configs")
    .select("enabled").eq("campaign_id", conversation.campaign_id).maybeSingle();
  if (error) throw new Error("No se pudo comprobar el modo de atención de WhatsApp.");
  const isHumanHandoff = conversation.ai_state === "handoff" || conversation.ai_state === "paused";
  if (!isHumanHandoff && !config) {
    throw new Error("No hay una configuración de IA válida. Solicita a Administración revisar la campaña antes de atender.");
  }
  if (!isHumanHandoff && config?.enabled !== false) {
    throw new Error("La IA está atendiendo esta conversación. Espera la derivación a atención humana.");
  }
}

async function claimHumanAttention(conversation: { id: string; ai_state: string }, actorId: string, note: string) {
  const admin = createAdminClient();
  const { data: claimed, error } = await admin.from("whatsapp_conversations")
    .update({ ai_state: "handoff" })
    .eq("id", conversation.id)
    .eq("assigned_to", actorId)
    .eq("ai_state", conversation.ai_state)
    .select("id")
    .maybeSingle();
  if (error || !claimed) {
    throw new Error("La conversación cambió de responsable o no se pudo confirmar la atención humana. Actualiza antes de enviar.");
  }
  // Preserve the original handoff reason; each human reply is not a new handoff.
  if (conversation.ai_state !== "handoff") {
    const { error: eventError } = await admin.from("whatsapp_conversation_events").insert({
      conversation_id: conversation.id,
      event_type: "ai_handoff",
      actor_id: actorId,
      note,
      metadata: { source: "human_attention", previous_ai_state: conversation.ai_state },
    });
    if (eventError) throw new Error("No se pudo registrar el inicio de la atención humana. El mensaje no fue enviado.");
  }
}

export async function sendWhatsAppMessage(formData: FormData) {
  const profile = await requireProfile(["agente"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!conversationId) throw new Error("No se identificó la conversación.");
  if (!body) throw new Error("Escribe un mensaje.");
  if (body.length > MAX_TEXT_LENGTH) throw new Error("El mensaje supera los 4.096 caracteres.");

  // RLS proves visibility only. Customer-facing actions additionally require
  // the agent role and current assignment before any privileged/provider write.
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id, channel_id, contact_wa_id, contact_phone, assigned_to, campaign_id, ai_state")
    .eq("id", conversationId)
    .single();
  if (conversationError || !conversation) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, conversation.assigned_to);
  await assertHumanAttentionAllowed(conversation);

  if (!isWhatsAppProviderConfigured()) {
    throw new Error("Falta completar el acceso del proveedor de WhatsApp para enviar desde Atlas.");
  }

  const admin = createAdminClient();

  // Human intervention owns the thread immediately, including while Mercury
  // may be generating a response in the background.
  await claimHumanAttention(conversation, profile.id, "El ejecutivo respondió manualmente.");

  const { data: channel, error: channelError } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, display_phone_number, status")
    .eq("id", conversation.channel_id)
    .single();
  if (channelError || !channel) throw new Error("El canal de WhatsApp no está configurado.");
  if (channel.status !== "active") throw new Error("El canal de WhatsApp todavía no está conectado.");

  const clientReference = randomUUID();
  const { data: pendingMessage, error: pendingError } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      message_type: "text",
      text_body: body,
      status: "pending",
      sent_by: profile.id,
      provider_payload: { provider: whatsappProvider(), client_reference: clientReference },
    })
    .select("id")
    .single();
  if (pendingError || !pendingMessage) throw new Error("No se pudo preparar el mensaje.");

  try {
    const { provider, providerMessageId, payload } = await sendWhatsAppText({
      phoneNumberId: channel.phone_number_id,
      from: channel.display_phone_number,
      to: conversation.contact_phone,
      body,
      clientReference,
    });

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("whatsapp_messages")
      .update({
        provider_message_id: providerMessageId,
        status: "accepted",
        provider_timestamp: now,
        provider_payload: { provider, client_reference: clientReference, response: payload },
      })
      .eq("id", pendingMessage.id);
    if (updateError) throw updateError;

    await admin
      .from("whatsapp_conversations")
      .update({ last_message_at: now, last_outbound_at: now, status: "open" })
      .eq("id", conversationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "El proveedor de WhatsApp no aceptó el mensaje.";
    await admin
      .from("whatsapp_messages")
      .update({ status: "failed", error_message: message.slice(0, 800) })
      .eq("id", pendingMessage.id);
    throw new Error(message);
  }

  revalidateWhatsApp(conversationId);
}

export async function prepareWhatsAppMediaUpload(input: {
  conversationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const profile = await requireProfile(["agente"]);
  if (!UUID.test(input.conversationId)) throw new Error("No se identificó la conversación.");
  const spec = validateWhatsAppMedia({ mimeType: input.mimeType, sizeBytes: input.sizeBytes });

  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id, assigned_to, campaign_id, ai_state, whatsapp_channels!inner(status)")
    .eq("id", input.conversationId)
    .single();
  if (conversationError || !conversation) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, conversation.assigned_to);
  await assertHumanAttentionAllowed(conversation);

  const uploadId = randomUUID();
  const clientReference = randomUUID();
  const storagePath = `outbound/${input.conversationId}/${profile.id}/${uploadId}.${spec.extension}`;
  const fileName = input.fileName.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || null;
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("whatsapp_media_uploads").insert({
    id: uploadId,
    conversation_id: input.conversationId,
    storage_bucket: WHATSAPP_MEDIA_BUCKET,
    storage_path: storagePath,
    message_type: spec.messageType,
    mime_type: spec.mimeType,
    size_bytes: input.sizeBytes,
    file_name: fileName,
    created_by: profile.id,
    client_reference: clientReference,
  });
  if (insertError) throw new Error("No se pudo preparar el adjunto.");

  const { data: signed, error: signedError } = await admin.storage
    .from(WHATSAPP_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signedError || !signed?.token) {
    await admin.from("whatsapp_media_uploads").update({
      status: "failed",
      error_message: "No se pudo autorizar la carga privada.",
    }).eq("id", uploadId);
    throw new Error("No se pudo autorizar la carga del adjunto.");
  }

  return { uploadId, storagePath, token: signed.token, mimeType: spec.mimeType };
}

export async function sendPreparedWhatsAppMedia(input: {
  uploadId: string;
  caption?: string;
}) {
  const profile = await requireProfile(["agente"]);
  if (!UUID.test(input.uploadId)) throw new Error("Adjunto inválido.");
  const caption = input.caption?.trim() ?? "";
  if (caption.length > MAX_MEDIA_CAPTION_LENGTH) {
    throw new Error("El texto de la imagen supera los 1.024 caracteres.");
  }
  if (!isWhatsAppProviderConfigured()) {
    throw new Error("Falta completar el acceso del proveedor de WhatsApp para enviar desde Atlas.");
  }

  const admin = createAdminClient();
  const { data: upload, error: uploadError } = await admin
    .from("whatsapp_media_uploads")
    .select("id, conversation_id, storage_bucket, storage_path, message_type, mime_type, size_bytes, file_name, created_by, client_reference, status, expires_at")
    .eq("id", input.uploadId)
    .single();
  if (uploadError || !upload || upload.created_by !== profile.id || upload.status !== "prepared") {
    throw new Error("El adjunto ya no está disponible para enviar.");
  }
  const spec = validateWhatsAppMedia({ mimeType: upload.mime_type, sizeBytes: Number(upload.size_bytes) });
  if (spec.messageType !== upload.message_type) throw new Error("El formato del adjunto no coincide con su tipo.");

  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("id, channel_id, contact_phone, assigned_to, campaign_id, ai_state")
    .eq("id", upload.conversation_id)
    .single();
  if (conversationError || !conversation) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, conversation.assigned_to);
  await assertHumanAttentionAllowed(conversation);
  if (new Date(upload.expires_at).getTime() <= Date.now()) {
    await admin.from("whatsapp_media_uploads").update({ status: "expired" }).eq("id", upload.id);
    throw new Error("La preparación del adjunto venció. Selecciónalo nuevamente.");
  }

  const pathParts = upload.storage_path.split("/");
  const objectName = pathParts.pop();
  const objectFolder = pathParts.join("/");
  const { data: objects, error: listError } = await admin.storage
    .from(upload.storage_bucket)
    .list(objectFolder, { limit: 10, search: objectName });
  const storedObject = objects?.find((object) => object.name === objectName);
  if (listError || !storedObject) throw new Error("El archivo no terminó de subir. Intenta nuevamente.");
  const storedSize = Number(storedObject.metadata?.size ?? upload.size_bytes);
  validateWhatsAppMedia({ mimeType: upload.mime_type, sizeBytes: storedSize });

  const { data: signed, error: signedError } = await admin.storage
    .from(upload.storage_bucket)
    .createSignedUrl(upload.storage_path, 60 * 60);
  if (signedError || !signed?.signedUrl) throw new Error("No se pudo preparar el archivo para WhatsApp.");

  const { data: channel, error: channelError } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, display_phone_number, status")
    .eq("id", conversation.channel_id)
    .single();
  if (channelError || !channel) throw new Error("El canal de WhatsApp no está configurado.");
  if (channel.status !== "active") throw new Error("El canal de WhatsApp todavía no está conectado.");

  await claimHumanAttention(conversation, profile.id, "El ejecutivo envió un adjunto manualmente.");

  const { data: pendingMessage, error: pendingError } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: conversation.id,
      direction: "outbound",
      message_type: upload.message_type,
      text_body: upload.message_type === "image" ? caption || null : null,
      status: "pending",
      sent_by: profile.id,
      media_storage_bucket: upload.storage_bucket,
      media_storage_path: upload.storage_path,
      media_mime_type: upload.mime_type,
      media_size_bytes: storedSize,
      media_file_name: upload.file_name,
      media_status: "ready",
      provider_payload: {
        provider: whatsappProvider(),
        client_reference: upload.client_reference,
        upload_id: upload.id,
      },
    })
    .select("id")
    .single();
  if (pendingError || !pendingMessage) throw new Error("No se pudo preparar el mensaje multimedia.");

  await admin.from("whatsapp_media_uploads").update({ message_id: pendingMessage.id }).eq("id", upload.id);
  try {
    const sent = await sendWhatsAppMedia({
      phoneNumberId: channel.phone_number_id,
      from: channel.display_phone_number,
      to: conversation.contact_phone,
      messageType: upload.message_type,
      mediaUrl: signed.signedUrl,
      caption: upload.message_type === "image" ? caption : null,
      clientReference: upload.client_reference,
    });
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("whatsapp_messages").update({
      provider_message_id: sent.providerMessageId,
      status: "accepted",
      provider_timestamp: now,
      provider_payload: {
        provider: sent.provider,
        client_reference: upload.client_reference,
        upload_id: upload.id,
        response: sent.payload,
      },
    }).eq("id", pendingMessage.id);
    if (updateError) throw updateError;
    await Promise.all([
      admin.from("whatsapp_media_uploads").update({ status: "sent", error_message: null }).eq("id", upload.id),
      admin.from("whatsapp_conversations").update({
        last_message_at: now,
        last_outbound_at: now,
        status: "open",
      }).eq("id", conversation.id),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "El proveedor de WhatsApp no aceptó el adjunto.";
    await Promise.all([
      admin.from("whatsapp_messages").update({ status: "failed", error_message: message.slice(0, 800) }).eq("id", pendingMessage.id),
      admin.from("whatsapp_media_uploads").update({ status: "failed", error_message: message.slice(0, 800) }).eq("id", upload.id),
    ]);
    throw new Error(message);
  }

  revalidateWhatsApp(conversation.id);
}

export async function markWhatsAppConversationRead(formData: FormData) {
  const profile = await requireProfile(["agente"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("id, assigned_to, campaign_id, ai_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, data.assigned_to);
  await assertHumanAttentionAllowed(data);

  const admin = createAdminClient();
  const { error } = await admin
    .from("whatsapp_conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
  revalidateWhatsApp(conversationId);
}

export async function setWhatsAppConversationStatus(formData: FormData) {
  const profile = await requireProfile(["agente"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!(["open", "pending"] as const).includes(status as "open" | "pending")) {
    throw new Error("Estado de conversación inválido.");
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("id, assigned_to, campaign_id, ai_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, data.assigned_to);
  await assertHumanAttentionAllowed(data);

  const admin = createAdminClient();
  const { error } = await admin.from("whatsapp_conversations").update({ status }).eq("id", conversationId);
  if (error) throw new Error(error.message);
  revalidateWhatsApp(conversationId);
}

export async function closeWhatsAppConversation(formData: FormData) {
  const profile = await requireProfile(["agente"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const reasonId = String(formData.get("reason_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(conversationId) || !UUID.test(reasonId)) {
    throw new Error("Selecciona una tipificación de cierre válida.");
  }
  if (note.length > 2000) throw new Error("La observación supera los 2.000 caracteres.");

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("whatsapp_conversations")
    .select("id, assigned_to, campaign_id, ai_state")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) throw new Error("No tienes acceso a esta conversación.");
  assertCanOperateAssignedConversation(profile, conversation.assigned_to);
  await assertHumanAttentionAllowed(conversation);

  const admin = createAdminClient();
  const { error } = await admin.rpc("close_whatsapp_conversation", {
    p_conversation_id: conversationId,
    p_reason_id: reasonId,
    p_note: note || null,
    p_actor_id: profile.id,
    p_automatic: false,
  });
  if (error) {
    if (error.message.includes("note_required")) {
      throw new Error("Esta tipificación requiere una observación de cierre.");
    }
    throw new Error(error.message);
  }
  revalidateWhatsApp(conversationId);
}

export async function setWhatsAppConversationAiState(_formData: FormData) {
  void _formData;
  await requireProfile();
  throw new Error("El modo de IA se controla desde Operación, no desde una conversación.");
}

export async function setWhatsAppAutomationEnabled(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const enabled = String(formData.get("enabled") ?? "");
  if (enabled !== "true" && enabled !== "false") throw new Error("Selecciona un modo de automatización válido.");
  const supabase = await createClient();
  // The transaction derives scope from the session; the client cannot submit
  // campaign IDs, actors, conversation state, or owners to widen its authority.
  const { error } = await supabase.rpc("set_whatsapp_automation_enabled", { p_enabled: enabled === "true" });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/operacion");
  revalidatePath("/dashboard/operacion/colas");
  revalidateWhatsApp();
}

export async function assignWhatsAppConversation(formData: FormData) {
  await requireProfile(["supervisor", "admin"]);
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const agentId = String(formData.get("agent_id") ?? "").trim() || null;
  const supabase = await createClient();
  const { data: conversation, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, lead_id, campaign_id, queue_id")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) throw new Error("No tienes acceso a esta conversación.");

  if (agentId) {
    const { data: membership } = conversation.queue_id
      ? await supabase
          .from("contact_center_queue_members")
          .select("profile_id, profiles!inner(active, role)")
          .eq("queue_id", conversation.queue_id)
          .eq("profile_id", agentId)
          .eq("is_active", true)
          .eq("profiles.active", true)
          .eq("profiles.role", "agente")
          .maybeSingle()
      : await supabase
          .from("campaign_agents")
          .select("profile_id, profiles!inner(active, role)")
          .eq("campaign_id", conversation.campaign_id)
          .eq("profile_id", agentId)
          .eq("profiles.active", true)
          .eq("profiles.role", "agente")
          .maybeSingle();
    if (!membership) throw new Error(conversation.queue_id ? "El ejecutivo no pertenece a esta cola." : "El ejecutivo no pertenece a esta campaña.");
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
  if (conversation.queue_id) revalidatePath(`/dashboard/admin/colas/${conversation.queue_id}`);
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

  const status = isWhatsAppProviderConfigured() ? "active" : "pending";
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
