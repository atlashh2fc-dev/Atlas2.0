export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WHATSAPP_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

const MEDIA_TYPES = {
  "image/jpeg": { messageType: "image", extension: "jpg", maxBytes: WHATSAPP_IMAGE_MAX_BYTES },
  "image/png": { messageType: "image", extension: "png", maxBytes: WHATSAPP_IMAGE_MAX_BYTES },
  "audio/aac": { messageType: "audio", extension: "aac", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
  "audio/mp4": { messageType: "audio", extension: "m4a", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
  "audio/mpeg": { messageType: "audio", extension: "mp3", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
  "audio/amr": { messageType: "audio", extension: "amr", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
  "audio/ogg": { messageType: "audio", extension: "ogg", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
  "audio/opus": { messageType: "audio", extension: "opus", maxBytes: WHATSAPP_AUDIO_MAX_BYTES },
} as const;

const MIME_ALIASES: Record<string, keyof typeof MEDIA_TYPES> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "application/ogg": "audio/ogg",
};

export type WhatsAppMediaMimeType = keyof typeof MEDIA_TYPES;
export type WhatsAppMediaMessageType = "image" | "audio";

export function normalizeWhatsAppMediaMimeType(mimeType: string): string {
  const baseType = mimeType.trim().toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return MIME_ALIASES[baseType] ?? baseType;
}

export function whatsappMediaSpec(mimeType: string) {
  const normalizedMimeType = normalizeWhatsAppMediaMimeType(mimeType);
  const spec = MEDIA_TYPES[normalizedMimeType as WhatsAppMediaMimeType];
  return spec ? { ...spec, mimeType: normalizedMimeType as WhatsAppMediaMimeType } : null;
}

export function validateWhatsAppMedia(input: {
  mimeType: string;
  sizeBytes: number;
}) {
  const spec = whatsappMediaSpec(input.mimeType);
  if (!spec) throw new Error("Formato no compatible. Adjunta una imagen JPG/PNG o un audio AAC, M4A, MP3, AMR, OGG u Opus.");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw new Error("El archivo está vacío o no se pudo leer.");
  }
  if (input.sizeBytes > spec.maxBytes) {
    const limit = spec.messageType === "image" ? "5 MB" : "16 MB";
    throw new Error(`El ${spec.messageType === "image" ? "archivo de imagen" : "audio"} supera el máximo de ${limit} de WhatsApp.`);
  }
  return spec;
}
