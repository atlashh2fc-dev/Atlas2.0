import { NextResponse } from "next/server";

import { captureWhatsAppMessageMedia } from "@/lib/whatsapp-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getCurrentProfile();
  if (!profile?.active) return error("Sesión no disponible.", 401);
  if (!getWorkspacePermissions(profile.role).canReadConversationContent) {
    return error("Tu perfil no permite consultar el contenido de conversaciones.", 403);
  }

  const { id } = await params;
  if (!UUID.test(id)) return error("Adjunto inválido.", 400);

  // Esta consulta usa la sesión y la RLS de whatsapp_messages. Recién después
  // el backend privilegiado puede copiar o firmar el objeto privado.
  const supabase = await createClient();
  const { data: accessible } = await supabase
    .from("whatsapp_messages")
    .select("id, message_type, conversation_id")
    .eq("id", id)
    .in("message_type", ["image", "audio"])
    .maybeSingle();
  if (!accessible) return error("Adjunto no encontrado.", 404);
  if (profile.role === "agente") {
    const { data: assignedConversation } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("id", accessible.conversation_id)
      .eq("assigned_to", profile.id)
      .maybeSingle();
    if (!assignedConversation) return error("Adjunto no encontrado.", 404);
  }

  const admin = createAdminClient();
  let { data: message, error: messageError } = await admin
    .from("whatsapp_messages")
    .select("id, media_storage_bucket, media_storage_path, media_status")
    .eq("id", id)
    .single();
  if (messageError || !message) return error("Adjunto no encontrado.", 404);

  if (message.media_status !== "ready" || !message.media_storage_bucket || !message.media_storage_path) {
    try {
      await captureWhatsAppMessageMedia(id);
      const refreshed = await admin
        .from("whatsapp_messages")
        .select("id, media_storage_bucket, media_storage_path, media_status")
        .eq("id", id)
        .single();
      message = refreshed.data;
      messageError = refreshed.error;
    } catch (captureError) {
      console.error("whatsapp_media_capture_failed", {
        messageId: id,
        message: captureError instanceof Error ? captureError.message.slice(0, 300) : "unknown",
      });
      return error("No se pudo recuperar el adjunto desde WhatsApp.", 503);
    }
  }

  if (messageError || !message?.media_storage_bucket || !message.media_storage_path) {
    return error("El adjunto todavía no está disponible.", 503);
  }
  const { data: signed, error: signedError } = await admin.storage
    .from(message.media_storage_bucket)
    .createSignedUrl(message.media_storage_path, 5 * 60);
  if (signedError || !signed?.signedUrl) return error("No se pudo abrir el adjunto.", 503);

  const response = NextResponse.redirect(signed.signedUrl, 307);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
