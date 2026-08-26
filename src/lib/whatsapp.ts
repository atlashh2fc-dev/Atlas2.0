import { createHmac, timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type WhatsAppReferral = {
  source_type?: string;
  source_id?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
};

export type ParsedWhatsAppMessage = {
  kind: "message";
  eventKey: string;
  phoneNumberId: string;
  direction: "inbound" | "outbound";
  providerMessageId: string;
  contactWaId: string;
  contactPhone: string;
  contactName: string | null;
  messageType: string;
  textBody: string | null;
  timestamp: string;
  senderWaId: string | null;
  contextProviderMessageId: string | null;
  referral: WhatsAppReferral;
  payload: JsonRecord;
};

export type ParsedWhatsAppStatus = {
  kind: "status";
  eventKey: string;
  phoneNumberId: string;
  providerMessageId: string;
  status: "accepted" | "sent" | "delivered" | "read" | "failed" | "deleted";
  timestamp: string;
  errorMessage: string | null;
  payload: JsonRecord;
};

export type ParsedWhatsAppEvent = ParsedWhatsAppMessage | ParsedWhatsAppStatus;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unixTimestamp(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : value;
}

function referral(value: unknown): WhatsAppReferral {
  const source = record(value);
  if (!source) return {};
  const result: WhatsAppReferral = {};
  for (const key of [
    "source_type",
    "source_id",
    "source_url",
    "headline",
    "body",
    "media_type",
    "image_url",
    "video_url",
    "thumbnail_url",
  ] as const) {
    const valueText = text(source[key]);
    if (valueText) result[key] = valueText;
  }
  return result;
}

function messageBody(message: JsonRecord, type: string): string | null {
  const typed = record(message[type]);
  if (type === "text") return text(typed?.body);
  if (type === "button") return text(typed?.text) ?? text(typed?.payload);
  if (type === "interactive") {
    const buttonReply = record(typed?.button_reply);
    const listReply = record(typed?.list_reply);
    return text(buttonReply?.title) ?? text(listReply?.title) ?? text(listReply?.description);
  }
  if (["image", "video", "document"].includes(type)) return text(typed?.caption);
  if (type === "location") {
    const latitude = typed?.latitude;
    const longitude = typed?.longitude;
    return latitude !== undefined && longitude !== undefined ? `${latitude}, ${longitude}` : null;
  }
  if (type === "contacts") return "Contacto compartido";
  if (type === "audio") return "Audio";
  if (type === "sticker") return "Sticker";
  return null;
}

function contactNames(value: JsonRecord) {
  const names = new Map<string, string>();
  for (const item of array(value.contacts)) {
    const contact = record(item);
    const waId = text(contact?.wa_id);
    const profile = record(contact?.profile);
    const name = text(profile?.name);
    if (waId && name) names.set(waId, name);
  }
  return names;
}

const STATUS_VALUES = new Set<ParsedWhatsAppStatus["status"]>([
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
]);

export function verifyMetaWebhookSignature(
  appSecret: string,
  rawBody: Buffer,
  suppliedHeader: string | null,
): boolean {
  if (!appSecret || !suppliedHeader?.startsWith("sha256=")) return false;
  const suppliedHex = suppliedHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "utf8");
  const supplied = Buffer.from(suppliedHex.toLowerCase(), "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/**
 * Flattens Meta's batched WABA envelope into idempotent message/status events.
 * Coexistence echoes from the WhatsApp Business app are treated as outbound so
 * the phone and Atlas share one continuous thread.
 */
export function parseWhatsAppWebhook(value: unknown): ParsedWhatsAppEvent[] {
  const envelope = record(value);
  if (text(envelope?.object) !== "whatsapp_business_account") return [];

  const events: ParsedWhatsAppEvent[] = [];
  for (const rawEntry of array(envelope?.entry)) {
    const entry = record(rawEntry);
    for (const rawChange of array(entry?.changes)) {
      const change = record(rawChange);
      const field = text(change?.field) ?? "messages";
      const changeValue = record(change?.value);
      if (!changeValue) continue;
      const metadata = record(changeValue.metadata);
      const phoneNumberId = text(metadata?.phone_number_id);
      if (!phoneNumberId) continue;

      const names = contactNames(changeValue);
      const direction: ParsedWhatsAppMessage["direction"] =
        field === "smb_message_echoes" ? "outbound" : "inbound";
      const messages = array(changeValue.messages).length
        ? array(changeValue.messages)
        : array(changeValue.smb_message_echoes);

      for (const rawMessage of messages) {
        const message = record(rawMessage);
        if (!message) continue;
        const providerMessageId = text(message.id);
        const contactWaId = direction === "inbound"
          ? text(message.from)
          : text(message.to) ?? text(message.recipient_id);
        if (!providerMessageId || !contactWaId) continue;
        const type = text(message.type) ?? "unknown";
        const context = record(message.context);
        const messageReferral = referral(message.referral ?? context?.referral);
        const timestamp = unixTimestamp(message.timestamp);
        events.push({
          kind: "message",
          eventKey: `message:${providerMessageId}`,
          phoneNumberId,
          direction,
          providerMessageId,
          contactWaId,
          contactPhone: normalizePhone(contactWaId),
          contactName: names.get(contactWaId) ?? null,
          messageType: type,
          textBody: messageBody(message, type),
          timestamp,
          senderWaId: direction === "inbound" ? contactWaId : text(message.from),
          contextProviderMessageId: text(context?.id),
          referral: messageReferral,
          payload: message,
        });
      }

      for (const rawStatus of array(changeValue.statuses)) {
        const statusPayload = record(rawStatus);
        if (!statusPayload) continue;
        const providerMessageId = text(statusPayload.id);
        const statusText = text(statusPayload.status) as ParsedWhatsAppStatus["status"] | null;
        if (!providerMessageId || !statusText || !STATUS_VALUES.has(statusText)) continue;
        const timestamp = unixTimestamp(statusPayload.timestamp);
        const firstError = record(array(statusPayload.errors)[0]);
        events.push({
          kind: "status",
          eventKey: `status:${providerMessageId}:${statusText}:${timestamp}`,
          phoneNumberId,
          providerMessageId,
          status: statusText,
          timestamp,
          errorMessage: text(firstError?.message) ?? text(firstError?.title),
          payload: statusPayload,
        });
      }
    }
  }
  return events;
}

export function whatsappGraphApiVersion(): string {
  const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : "v25.0";
}
