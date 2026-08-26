import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappGraphApiVersion } from "@/lib/whatsapp";
import {
  validateWhatsAppMedia,
  whatsappMediaSpec,
  type WhatsAppMediaMessageType,
} from "@/lib/whatsapp-media-format";
import { whatsappProvider, type WhatsAppProvider } from "@/lib/whatsapp-provider";

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
export {
  WHATSAPP_AUDIO_MAX_BYTES,
  WHATSAPP_IMAGE_MAX_BYTES,
  normalizeWhatsAppMediaMimeType,
  validateWhatsAppMedia,
  whatsappMediaSpec,
} from "@/lib/whatsapp-media-format";
export type { WhatsAppMediaMessageType, WhatsAppMediaMimeType } from "@/lib/whatsapp-media-format";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assertTrustedMediaUrl(value: string) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const trusted = parsed.protocol === "https:" && (
    hostname === "api.ycloud.com"
    || hostname === "lookaside.fbsbx.com"
    || hostname.endsWith(".fbcdn.net")
    || hostname === "facebook.com"
    || hostname.endsWith(".facebook.com")
  );
  if (!trusted) throw new Error("El proveedor informó una ubicación multimedia no autorizada.");
  return parsed.toString();
}

function providerFromPayload(payload: JsonRecord): WhatsAppProvider | null {
  const provider = text(payload.provider);
  return provider === "meta" || provider === "ycloud" ? provider : null;
}

function descriptor(payload: JsonRecord, messageType: WhatsAppMediaMessageType) {
  const media = record(payload[messageType]);
  if (!media) throw new Error("El webhook no incluyó los metadatos del adjunto.");
  return {
    id: text(media.id),
    url: text(media.link) ?? text(media.url),
    mimeType: text(media.mime_type),
    sha256: text(media.sha256),
    fileName: text(media.filename),
  };
}

async function metaMediaUrl(mediaId: string) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("Falta el acceso de Meta para descargar el adjunto.");
  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(mediaId)}`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );
  const payload = record(await response.json().catch(() => null));
  const url = text(payload?.url);
  if (!response.ok || !url) throw new Error("Meta no entregó el archivo adjunto.");
  return { url, accessToken };
}

async function readLimited(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("El adjunto recibido supera el máximo admitido por WhatsApp.");
  }
  if (!response.body) throw new Error("El proveedor devolvió un adjunto vacío.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("El adjunto recibido supera el máximo admitido por WhatsApp.");
    }
    chunks.push(value);
  }
  if (total < 1) throw new Error("El proveedor devolvió un adjunto vacío.");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function downloadMedia(input: {
  provider: WhatsAppProvider;
  url: string | null;
  mediaId: string | null;
  maxBytes: number;
}) {
  let url = input.url;
  const headers: Record<string, string> = {};
  const fallbackUrls: string[] = [];

  if (input.provider === "ycloud") {
    const apiKey = process.env.WHATSAPP_YCLOUD_API_KEY?.trim();
    if (!apiKey) throw new Error("Falta la clave de YCloud para descargar el adjunto.");
    headers["x-api-key"] = apiKey;
    if (input.mediaId) {
      fallbackUrls.push(`https://api.ycloud.com/v2/whatsapp/media/download/${encodeURIComponent(input.mediaId)}`);
    }
  } else {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    if (input.mediaId) {
      const resolved = await metaMediaUrl(input.mediaId);
      url = resolved.url;
      headers.authorization = `Bearer ${resolved.accessToken}`;
    } else {
      if (!url) throw new Error("Meta no informó el identificador ni la URL del adjunto.");
      if (!accessToken) throw new Error("Falta el acceso de Meta para descargar el adjunto.");
      headers.authorization = `Bearer ${accessToken}`;
    }
  }

  if (!url) throw new Error("El proveedor no informó una URL para el adjunto.");
  let lastStatus = 0;
  for (const candidateUrl of [url, ...fallbackUrls.filter((candidate) => candidate !== url)]) {
    const response = await fetch(assertTrustedMediaUrl(candidateUrl), {
      headers,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    lastStatus = response.status;
    if (!response.ok) continue;
    return {
      bytes: await readLimited(response, input.maxBytes),
      contentType: text(response.headers.get("content-type")?.split(";")[0]),
    };
  }
  throw new Error(`No se pudo descargar el adjunto (${lastStatus || "sin respuesta"}).`);
}

/**
 * Copia una imagen o audio entrante desde la URL efímera del proveedor hacia
 * Storage privado. Es idempotente: reintentos del webhook o del endpoint de
 * lectura convergen en la misma ruta por mensaje.
 */
export async function captureWhatsAppMessageMedia(messageId: string) {
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("whatsapp_messages")
    .select("id, conversation_id, provider_message_id, message_type, provider_payload, media_status, media_storage_bucket, media_storage_path")
    .eq("id", messageId)
    .single();
  if (error || !message) throw error ?? new Error("Mensaje multimedia no encontrado.");
  if (message.media_status === "ready" && message.media_storage_path) return message;
  if (message.message_type !== "image" && message.message_type !== "audio") {
    throw new Error("El mensaje no contiene una imagen o audio compatible.");
  }

  const payload = record(message.provider_payload) ?? {};
  const media = descriptor(payload, message.message_type);
  const sourceMimeType = media.mimeType ?? "";
  const spec = whatsappMediaSpec(sourceMimeType);
  if (!spec || spec.messageType !== message.message_type) {
    throw new Error("El formato del adjunto recibido no es compatible.");
  }

  await admin.from("whatsapp_messages").update({ media_status: "pending", error_message: null }).eq("id", messageId);
  try {
    let sourceProvider = providerFromPayload(payload);
    if (!sourceProvider && message.provider_message_id) {
      const { data: webhookEvent } = await admin
        .from("whatsapp_webhook_events")
        .select("payload")
        .eq("provider_event_key", `message:${message.provider_message_id}`)
        .maybeSingle();
      sourceProvider = providerFromPayload(record(webhookEvent?.payload) ?? {});
    }

    const downloaded = await downloadMedia({
      provider: sourceProvider ?? whatsappProvider(),
      url: media.url,
      mediaId: media.id,
      maxBytes: spec.maxBytes,
    });
    const actualMimeType = downloaded.contentType && whatsappMediaSpec(downloaded.contentType)
      ? whatsappMediaSpec(downloaded.contentType)!.mimeType
      : spec.mimeType;
    const actualSpec = validateWhatsAppMedia({ mimeType: actualMimeType, sizeBytes: downloaded.bytes.length });
    if (actualSpec.messageType !== message.message_type) throw new Error("El contenido del adjunto no coincide con su tipo.");

    const actualSha256 = createHash("sha256").update(downloaded.bytes).digest("base64");
    if (media.sha256 && media.sha256 !== actualSha256) throw new Error("La verificación de integridad del adjunto falló.");

    const storagePath = `inbound/${message.conversation_id}/${message.id}.${actualSpec.extension}`;
    const { error: uploadError } = await admin.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .upload(storagePath, downloaded.bytes, {
        contentType: actualMimeType,
        cacheControl: "31536000",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const values = {
      media_storage_bucket: WHATSAPP_MEDIA_BUCKET,
      media_storage_path: storagePath,
      media_mime_type: actualMimeType,
      media_size_bytes: downloaded.bytes.length,
      media_file_name: media.fileName,
      media_sha256: actualSha256,
      media_status: "ready",
      error_message: null,
    };
    const { error: updateError } = await admin.from("whatsapp_messages").update(values).eq("id", message.id);
    if (updateError) throw updateError;
    return { ...message, ...values };
  } catch (captureError) {
    const captureMessage = captureError instanceof Error ? captureError.message : "No se pudo conservar el adjunto.";
    await admin
      .from("whatsapp_messages")
      .update({ media_status: "failed", error_message: captureMessage.slice(0, 800) })
      .eq("id", message.id);
    throw captureError;
  }
}
