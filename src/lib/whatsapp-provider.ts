import { normalizeWhatsAppPhone, whatsappGraphApiVersion } from "@/lib/whatsapp";

export type WhatsAppProvider = "meta" | "ycloud";

type SendTextInput = {
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

type SendMediaInput = {
  phoneNumberId: string;
  from: string;
  to: string;
  messageType: "image" | "audio";
  mediaUrl: string;
  caption?: string | null;
  clientReference: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function whatsappProvider(): WhatsAppProvider {
  return process.env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "ycloud" ? "ycloud" : "meta";
}

export function isWhatsAppProviderConfigured(): boolean {
  if (whatsappProvider() === "ycloud") {
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
  const provider = whatsappProvider();
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

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
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

export async function sendWhatsAppMedia(input: SendMediaInput): Promise<SendTextResult> {
  const provider = whatsappProvider();
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

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
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
