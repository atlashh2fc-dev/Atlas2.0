import { esCanalSocial } from "@/lib/mensajeria-social";
import { enviarMensajeSocial, escribiendoEnSocial } from "@/lib/meta-mensajeria";
import { normalizeWhatsAppPhone, whatsappGraphApiVersion } from "@/lib/whatsapp";
import { accesoDeMeta } from "@/lib/whatsapp-credenciales";

export type WhatsAppProvider = "meta" | "ycloud";

/**
 * Cada canal dice por dónde sale: Geimser habla directo con Meta y Altius pasa
 * por YCloud, que es quien permite usar el mismo número en la app Business del
 * teléfono y en el CRM (coexistencia). Sin canal, manda la variable de entorno.
 */
type ConProveedor = {
  provider?: WhatsAppProvider | string | null;
  /** Con Meta, el canal decide el token: los conectados desde Atlas traen el suyo. */
  channelId?: string | null;
  /**
   * Instagram y Messenger salen por la página de Facebook del canal hacia el
   * identificador del contacto en ella (contact_wa_id), no a un teléfono.
   */
  canal?: string | null;
  pageId?: string | null;
  recipientId?: string | null;
};

function destinoSocial(input: ConProveedor) {
  if (!esCanalSocial(input.canal)) return null;
  if (!input.channelId || !input.pageId || !input.recipientId) {
    throw new Error("La conversación no tiene la página o el contacto de Meta para responder.");
  }
  return { channelId: input.channelId, pageId: input.pageId, recipientId: input.recipientId };
}

type SendTextInput = ConProveedor & {
  phoneNumberId: string;
  from: string;
  to: string;
  body: string;
  clientReference: string;
};

type SendTextResult = {
  provider: WhatsAppProvider;
  providerMessageId: string;
  payload: Record<string, unknown>;
};

type SendMediaInput = ConProveedor & {
  phoneNumberId: string;
  from: string;
  to: string;
  messageType: "image" | "audio";
  mediaUrl: string;
  caption?: string | null;
  clientReference: string;
};

type SendTypingIndicatorInput = ConProveedor & {
  phoneNumberId: string;
  providerMessageId: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function whatsappProvider(delCanal?: WhatsAppProvider | string | null): WhatsAppProvider {
  if (delCanal === "ycloud" || delCanal === "meta") return delCanal;
  return process.env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "ycloud" ? "ycloud" : "meta";
}

export function isWhatsAppProviderConfigured(delCanal?: WhatsAppProvider | string | null): boolean {
  if (whatsappProvider(delCanal) === "ycloud") {
    return Boolean(
      process.env.WHATSAPP_YCLOUD_API_KEY?.trim()
      && process.env.WHATSAPP_YCLOUD_WEBHOOK_SECRET?.trim(),
    );
  }
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    && process.env.WHATSAPP_META_APP_SECRET?.trim()
    && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
  );
}

export async function sendWhatsAppText(input: SendTextInput): Promise<SendTextResult> {
  const social = destinoSocial(input);
  if (social) {
    const enviado = await enviarMensajeSocial({ ...social, message: { text: input.body } });
    return { provider: "meta", ...enviado };
  }
  const provider = whatsappProvider(input.provider);
  if (provider === "ycloud") {
    const apiKey = process.env.WHATSAPP_YCLOUD_API_KEY?.trim();
    if (!apiKey) throw new Error("Falta completar la clave API de YCloud.");

    const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        from: normalizeWhatsAppPhone(input.from),
        to: normalizeWhatsAppPhone(input.to),
        type: "text",
        text: { body: input.body },
        externalId: input.clientReference,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const decoded = await response.json().catch(() => ({}));
    const payload = record(decoded) ?? {};
    const message = record(payload.whatsappMessage) ?? payload;
    const error = record(payload.error);
    const providerMessageId = text(message.wamid) ?? text(message.id);
    if (!response.ok || !providerMessageId) {
      throw new Error(
        text(error?.message)
        ?? text(payload.message)
        ?? `YCloud rechazó el mensaje (${response.status}).`,
      );
    }
    return { provider, providerMessageId, payload };
  }

  const accessToken = await accesoDeMeta(input.channelId);
  if (!accessToken) throw new Error("Falta completar el acceso de Meta para enviar desde Atlas.");
  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.body },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const decoded = await response.json().catch(() => ({}));
  const payload = record(decoded) ?? {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const firstMessage = record(messages[0]);
  const error = record(payload.error);
  const providerMessageId = text(firstMessage?.id);
  if (!response.ok || !providerMessageId) {
    throw new Error(text(error?.message) ?? `Meta rechazó el mensaje (${response.status}).`);
  }
  return { provider, providerMessageId, payload };
}

export async function sendWhatsAppTypingIndicator(input: SendTypingIndicatorInput): Promise<void> {
  const social = destinoSocial(input);
  if (social) return escribiendoEnSocial(social.channelId, social.pageId, social.recipientId);
  const provider = whatsappProvider(input.provider);
  if (provider === "ycloud") {
    const apiKey = process.env.WHATSAPP_YCLOUD_API_KEY?.trim();
    if (!apiKey) throw new Error("Falta completar la clave API de YCloud.");

    const response = await fetch(
      `https://api.ycloud.com/v2/whatsapp/inboundMessages/${encodeURIComponent(input.providerMessageId)}/typingIndicator`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      const decoded = await response.json().catch(() => ({}));
      const payload = record(decoded) ?? {};
      const error = record(payload.error);
      throw new Error(
        text(error?.message)
        ?? text(payload.message)
        ?? `YCloud rechazó el indicador de escritura (${response.status}).`,
      );
    }
    return;
  }

  const accessToken = await accesoDeMeta(input.channelId);
  if (!accessToken) throw new Error("Falta completar el acceso de Meta para mostrar el indicador de escritura.");
  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: input.providerMessageId,
        typing_indicator: { type: "text" },
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    const decoded = await response.json().catch(() => ({}));
    const payload = record(decoded) ?? {};
    const error = record(payload.error);
    throw new Error(text(error?.message) ?? `Meta rechazó el indicador de escritura (${response.status}).`);
  }
}

export async function sendWhatsAppMedia(input: SendMediaInput): Promise<SendTextResult> {
  const social = destinoSocial(input);
  if (social) {
    // Messenger e Instagram no llevan pie de foto: el texto sale aparte, después.
    const enviado = await enviarMensajeSocial({
      ...social,
      message: { attachment: { type: input.messageType, payload: { url: input.mediaUrl, is_reusable: false } } },
    });
    if (input.caption?.trim()) await enviarMensajeSocial({ ...social, message: { text: input.caption.trim() } });
    return { provider: "meta", ...enviado };
  }
  const provider = whatsappProvider(input.provider);
  const media = input.messageType === "image"
    ? { link: input.mediaUrl, ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}) }
    : { link: input.mediaUrl };

  if (provider === "ycloud") {
    const apiKey = process.env.WHATSAPP_YCLOUD_API_KEY?.trim();
    if (!apiKey) throw new Error("Falta completar la clave API de YCloud.");
    const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        from: normalizeWhatsAppPhone(input.from),
        to: normalizeWhatsAppPhone(input.to),
        type: input.messageType,
        [input.messageType]: media,
        externalId: input.clientReference,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const decoded = await response.json().catch(() => ({}));
    const payload = record(decoded) ?? {};
    const message = record(payload.whatsappMessage) ?? payload;
    const error = record(payload.error);
    const providerMessageId = text(message.wamid) ?? text(message.id);
    if (!response.ok || !providerMessageId) {
      throw new Error(
        text(error?.message)
        ?? text(payload.message)
        ?? `YCloud rechazó el adjunto (${response.status}).`,
      );
    }
    return { provider, providerMessageId, payload };
  }

  const accessToken = await accesoDeMeta(input.channelId);
  if (!accessToken) throw new Error("Falta completar el acceso de Meta para enviar desde Atlas.");
  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: input.messageType,
        [input.messageType]: media,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const decoded = await response.json().catch(() => ({}));
  const payload = record(decoded) ?? {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const firstMessage = record(messages[0]);
  const error = record(payload.error);
  const providerMessageId = text(firstMessage?.id);
  if (!response.ok || !providerMessageId) {
    throw new Error(text(error?.message) ?? `Meta rechazó el adjunto (${response.status}).`);
  }
  return { provider, providerMessageId, payload };
}

type SendTemplateInput = ConProveedor & {
  phoneNumberId: string;
  from: string;
  to: string;
  /** Nombre de la plantilla aprobada en Meta. */
  template: string;
  language: string;
  parameters: string[];
  clientReference: string;
};

/**
 * Envía una plantilla aprobada por Meta: lo único que WhatsApp acepta para
 * escribirle a alguien fuera de las 24 horas desde su último mensaje.
 */
export async function sendWhatsAppTemplate(input: SendTemplateInput): Promise<SendTextResult> {
  const plantilla = {
    name: input.template,
    language: { code: input.language },
    components: input.parameters.length
      ? [{ type: "body", parameters: input.parameters.map((valor) => ({ type: "text", text: valor })) }]
      : [],
  };
  const provider = whatsappProvider(input.provider);
  if (provider === "ycloud") {
    const apiKey = process.env.WHATSAPP_YCLOUD_API_KEY?.trim();
    if (!apiKey) throw new Error("Falta completar la clave API de YCloud.");
    const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        from: normalizeWhatsAppPhone(input.from),
        to: normalizeWhatsAppPhone(input.to),
        type: "template",
        template: plantilla,
        externalId: input.clientReference,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const decoded = await response.json().catch(() => ({}));
    const payload = record(decoded) ?? {};
    const message = record(payload.whatsappMessage) ?? payload;
    const error = record(payload.error);
    const providerMessageId = text(message.wamid) ?? text(message.id);
    if (!response.ok || !providerMessageId) {
      throw new Error(text(error?.message) ?? text(payload.message) ?? `YCloud rechazó la plantilla (${response.status}).`);
    }
    return { provider, providerMessageId, payload };
  }

  const accessToken = await accesoDeMeta(input.channelId);
  if (!accessToken) throw new Error("Falta completar el acceso de Meta para enviar desde Atlas.");
  const response = await fetch(
    `https://graph.facebook.com/${whatsappGraphApiVersion()}/${encodeURIComponent(input.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, type: "template", template: plantilla }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const decoded = await response.json().catch(() => ({}));
  const payload = record(decoded) ?? {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const providerMessageId = text(record(messages[0])?.id);
  const error = record(payload.error);
  if (!response.ok || !providerMessageId) {
    throw new Error(text(error?.message) ?? `Meta rechazó la plantilla (${response.status}).`);
  }
  return { provider, providerMessageId, payload };
}
