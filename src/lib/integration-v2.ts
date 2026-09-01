import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const INTEGRATION_V2_MAX_BYTES = 1024 * 1024;
export const INTEGRATION_V2_MAX_ITEMS = 500;
export const INTEGRATION_V2_OUTBOUND_MAX_ITEMS = 250;
export const INTEGRATION_V2_SIGNATURE_TOLERANCE_SECONDS = 300;

export type IntegrationV2EventType =
  | "intelligence.decision.v1"
  | "engagement.event.v1"
  | "integration.canary.v1";

export type IntegrationEngagementEventKind =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "unsubscribed";

export type IntegrationEngagementSemantics = "atomic_event" | "cumulative_snapshot";

export type IntegrationV2Item = {
  event_id: string;
  event_type: IntegrationV2EventType;
  event_source: "urn:geimser:atlas2" | "urn:geimser:atlas-lead" | "urn:geimser:bigdata";
  subject: string;
  external_key: string;
  occurred_at: string;
  data_schema: string;
  tenant_id: string;
  entity_version: number;
  correlation_id: string;
  causation_id: string | null;
  payload: Record<string, unknown>;
};

export type IntegrationV2Batch = {
  campaign_id: string | null;
  campaign_key: string | null;
  schema_version: string;
  metadata: Record<string, unknown>;
  items: IntegrationV2Item[];
};

function boolish(value: unknown) {
  return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t", "yes", "y", "si", "s", "x"].includes(value.trim().toLowerCase()));
}

function firstValue(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  }
  return undefined;
}

export class IntegrationV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationV2ValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new IntegrationV2ValidationError(`${field} es inválido.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, maxLength);
}

const ENGAGEMENT_EVENT_KINDS = new Set<IntegrationEngagementEventKind>([
  "sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed",
]);

function parseEngagementPayload(payload: Record<string, unknown>, index: number) {
  const externalCampaignKey = requiredText(
    payload.external_campaign_key,
    `items[${index}].payload.external_campaign_key`,
    300,
  );
  const eventKind = optionalText(payload.event_kind, `items[${index}].payload.event_kind`, 40);
  if (eventKind && !ENGAGEMENT_EVENT_KINDS.has(eventKind as IntegrationEngagementEventKind)) {
    throw new IntegrationV2ValidationError(`items[${index}].payload.event_kind no es soportado.`);
  }
  const eventSemantics = optionalText(
    payload.event_semantics,
    `items[${index}].payload.event_semantics`,
    40,
  );
  if (eventSemantics && eventSemantics !== "atomic_event" && eventSemantics !== "cumulative_snapshot") {
    throw new IntegrationV2ValidationError(`items[${index}].payload.event_semantics no es soportado.`);
  }
  const linkUrl = optionalText(payload.link_url, `items[${index}].payload.link_url`, 2048);
  if (linkUrl) {
    let parsed: URL;
    try {
      parsed = new URL(linkUrl);
    } catch {
      throw new IntegrationV2ValidationError(`items[${index}].payload.link_url debe ser una URL absoluta.`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new IntegrationV2ValidationError(`items[${index}].payload.link_url debe usar HTTP o HTTPS.`);
    }
  }

  const optionalFields = {
    delivery_id: optionalText(payload.delivery_id, `items[${index}].payload.delivery_id`, 500),
    message_id: optionalText(payload.message_id, `items[${index}].payload.message_id`, 500),
    message_subject: optionalText(payload.message_subject, `items[${index}].payload.message_subject`, 1000),
    provider_event_id: optionalText(payload.provider_event_id, `items[${index}].payload.provider_event_id`, 500),
    company_name: optionalText(payload.company_name, `items[${index}].payload.company_name`, 500),
    contact_name: optionalText(payload.contact_name, `items[${index}].payload.contact_name`, 500),
    phone: optionalText(payload.phone, `items[${index}].payload.phone`, 100),
    country: optionalText(payload.country, `items[${index}].payload.country`, 100),
    source_lead_id: optionalText(payload.source_lead_id, `items[${index}].payload.source_lead_id`, 500),
  };

  return {
    ...payload,
    external_campaign_key: externalCampaignKey,
    ...(eventKind ? { event_kind: eventKind } : {}),
    ...(eventSemantics ? { event_semantics: eventSemantics } : {}),
    ...(linkUrl ? { link_url: linkUrl } : {}),
    ...Object.fromEntries(Object.entries(optionalFields).filter(([, fieldValue]) => fieldValue !== undefined)),
  };
}

export function integrationV2EventSource(sourceCode: string): IntegrationV2Item["event_source"] {
  const normalized = sourceCode.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "atlas2" || normalized === "atlas-lead" || normalized === "bigdata") {
    return `urn:geimser:${normalized}`;
  }
  throw new IntegrationV2ValidationError("x-atlas-source no tiene un event_source canónico.");
}

export function parseIntegrationV2Batch(value: unknown, sourceCode = "bigdata"): IntegrationV2Batch {
  if (!isObject(value)) {
    throw new IntegrationV2ValidationError("El cuerpo debe ser un objeto JSON.");
  }

  const campaignId = typeof value.campaign_id === "string" && value.campaign_id.trim()
    ? value.campaign_id.trim()
    : null;
  const campaignKeyValue = firstValue(value, ["campaign_key", "external_campaign_key"]);
  const campaignKey = typeof campaignKeyValue === "string" && campaignKeyValue.trim()
    ? campaignKeyValue.trim()
    : null;
  const canaryOnly = Array.isArray(value.items) && value.items.length > 0
    && value.items.every((item) => isObject(item) && item.event_type === "integration.canary.v1");
  if (!campaignId && !campaignKey && !canaryOnly) {
    throw new IntegrationV2ValidationError("campaign_key es obligatorio (campaign_id solo se admite para canary/admin)." );
  }
  if (campaignId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(campaignId)) {
    throw new IntegrationV2ValidationError("campaign_id debe ser UUID.");
  }
  if (campaignKey && campaignKey.length > 300) {
    throw new IntegrationV2ValidationError("campaign_key es inválido.");
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > INTEGRATION_V2_MAX_ITEMS) {
    throw new IntegrationV2ValidationError("items debe contener entre 1 y 500 eventos.");
  }

  const schemaVersion = typeof value.schema_version === "string" && value.schema_version.trim()
    ? value.schema_version.trim()
    : "1";
  if (schemaVersion !== "1" && schemaVersion !== "2") {
    throw new IntegrationV2ValidationError("schema_version debe ser 1 o 2.");
  }
  const expectedEventSource = integrationV2EventSource(sourceCode);

  const seen = new Set<string>();
  const items = value.items.map((candidate, index): IntegrationV2Item => {
    if (!isObject(candidate)) {
      throw new IntegrationV2ValidationError(`items[${index}] debe ser un objeto.`);
    }
    const eventId = requiredText(candidate.event_id, `items[${index}].event_id`, 200);
    const idempotencyIdentity = `${expectedEventSource}\n${eventId}`;
    if (seen.has(idempotencyIdentity)) {
      throw new IntegrationV2ValidationError(`event_id duplicado: ${eventId}.`);
    }
    seen.add(idempotencyIdentity);
    const eventType = requiredText(candidate.event_type, `items[${index}].event_type`, 80);
    if (eventType !== "intelligence.decision.v1" && eventType !== "engagement.event.v1" && eventType !== "integration.canary.v1") {
      throw new IntegrationV2ValidationError(`event_type no soportado: ${eventType}.`);
    }
    const occurredAt = requiredText(candidate.occurred_at, `items[${index}].occurred_at`, 40);
    if (!Number.isFinite(Date.parse(occurredAt))) {
      throw new IntegrationV2ValidationError(`items[${index}].occurred_at es inválido.`);
    }
    const externalKey = requiredText(candidate.external_key, `items[${index}].external_key`, 500);
    if (!isObject(candidate.payload)) {
      throw new IntegrationV2ValidationError(`items[${index}].payload debe ser un objeto.`);
    }
    let payload = candidate.payload;
    if (eventType === "intelligence.decision.v1") {
      const rank = candidate.payload.priority_rank;
      if (!Number.isInteger(rank) || Number(rank) < 0 || Number(rank) > 999) {
        throw new IntegrationV2ValidationError(`items[${index}].payload.priority_rank debe estar entre 0 y 999.`);
      }
    } else if (eventType === "engagement.event.v1") {
      payload = parseEngagementPayload(candidate.payload, index);
    }
    const suppliedEventSource = candidate.event_source === undefined
      ? expectedEventSource
      : requiredText(candidate.event_source, `items[${index}].event_source`, 80);
    if (suppliedEventSource !== expectedEventSource) {
      throw new IntegrationV2ValidationError(`items[${index}].event_source no coincide con x-atlas-source.`);
    }
    const entityVersion = candidate.entity_version === undefined && schemaVersion === "1"
      ? Math.max(1, Date.parse(occurredAt))
      : candidate.entity_version;
    if (!Number.isSafeInteger(entityVersion) || Number(entityVersion) < 1) {
      throw new IntegrationV2ValidationError(`items[${index}].entity_version debe ser un entero positivo.`);
    }
    const subject = candidate.subject === undefined && schemaVersion === "1"
      ? `urn:geimser:legacy:${sourceCode.replaceAll("_", "-")}:${externalKey}`
      : requiredText(candidate.subject, `items[${index}].subject`, 500);
    const dataSchema = candidate.data_schema === undefined && schemaVersion === "1"
      ? `urn:geimser:schema:${eventType}`
      : requiredText(candidate.data_schema, `items[${index}].data_schema`, 500);
    const tenantId = candidate.tenant_id === undefined && schemaVersion === "1"
      ? "geimser"
      : requiredText(candidate.tenant_id, `items[${index}].tenant_id`, 100);
    const correlationId = candidate.correlation_id === undefined && schemaVersion === "1"
      ? eventId
      : requiredText(candidate.correlation_id, `items[${index}].correlation_id`, 200);
    const causationId = candidate.causation_id === undefined || candidate.causation_id === null
      ? null
      : requiredText(candidate.causation_id, `items[${index}].causation_id`, 200);
    return {
      event_id: eventId,
      event_type: eventType,
      event_source: expectedEventSource,
      subject,
      external_key: externalKey,
      occurred_at: new Date(occurredAt).toISOString(),
      data_schema: dataSchema,
      tenant_id: tenantId,
      entity_version: Number(entityVersion),
      correlation_id: correlationId,
      causation_id: causationId,
      payload,
    };
  });

  return {
    campaign_id: campaignId,
    campaign_key: campaignKey,
    schema_version: schemaVersion,
    metadata: isObject(value.metadata) ? value.metadata : {},
    items,
  };
}

/** Converts the current Atlas Lead report envelope/Spanish aliases to the
 * canonical engagement.event.v1 transport. Canonical v2 envelopes pass through.
 */
export function normalizeIntegrationV2Request(
  value: unknown,
  sourceCode: string,
  idempotencyKey: string,
): unknown {
  if (sourceCode !== "atlas_lead" || !isObject(value)) return value;

  const externalCampaignKey = firstValue(value, ["external_campaign_key", "campaign_key"]);
  if (Array.isArray(value.items)) {
    return {
      ...value,
      items: value.items.map((item) =>
        isObject(item) && item.event_type === "engagement.event.v1" && isObject(item.payload)
          ? { ...item, payload: { external_campaign_key: externalCampaignKey, ...item.payload } }
          : item,
      ),
    };
  }
  if (!Array.isArray(value.rows)) return value;

  const batchOccurredAt = firstValue(value, ["occurred_at", "reported_at"]);
  const reportDate = typeof value.report_date === "string" ? `${value.report_date}T12:00:00Z` : undefined;
  return {
    campaign_id: value.campaign_id,
    campaign_key: value.campaign_key ?? externalCampaignKey,
    schema_version: value.schema_version,
    metadata: isObject(value.metadata) ? value.metadata : {},
    items: value.rows.map((row, index) => {
      if (!isObject(row)) return row;
      const email = firstValue(row, ["email", "mail", "correo"]);
      const eventId = firstValue(row, ["event_id", "id"]) ?? `${idempotencyKey}:${index + 1}`;
      const deliveryId = firstValue(row, ["delivery_id", "deliveryId"]);
      const messageId = firstValue(row, ["message_id", "messageId"]);
      const messageSubject = firstValue(row, ["message_subject", "messageSubject", "subject"]);
      const eventKind = firstValue(row, ["event_kind", "eventKind"]);
      const linkUrl = firstValue(row, ["link_url", "linkUrl", "clicked_url"]);
      const providerEventId = firstValue(row, ["provider_event_id", "providerEventId"]);
      const companyName = firstValue(row, ["company_name", "companyName"]);
      const contactName = firstValue(row, ["contact_name", "contactName", "full_name"]);
      const phone = firstValue(row, ["phone", "telefono", "mobile"]);
      const country = firstValue(row, ["country", "pais"]);
      const sourceLeadId = firstValue(row, ["source_lead_id", "sourceLeadId", "lead_id"]);
      return {
        event_id: eventId,
        event_type: "engagement.event.v1",
        external_key: firstValue(row, ["external_key", "lead_id", "contact_id"]) ?? email,
        occurred_at: firstValue(row, ["occurred_at", "event_at", "timestamp"]) ?? batchOccurredAt ?? reportDate,
        payload: {
          external_campaign_key: externalCampaignKey,
          email,
          sent: boolish(row.sent) || boolish(row.enviado),
          delivered: boolish(row.delivered) || boolish(row.entregado),
          bounced: boolish(row.bounced) || boolish(row.rebote),
          opened: boolish(row.opened) || boolish(row.abierto) || boolish(row.open),
          clicked: boolish(row.clicked) || boolish(row.click),
          complained: boolish(row.complained) || boolish(row.queja),
          unsubscribed: boolish(row.unsubscribed) || boolish(row.desuscrito),
          event_semantics: "cumulative_snapshot",
          ...(deliveryId ? { delivery_id: deliveryId } : {}),
          ...(messageId ? { message_id: messageId } : {}),
          ...(messageSubject ? { message_subject: messageSubject } : {}),
          ...(eventKind ? { event_kind: eventKind } : {}),
          ...(linkUrl ? { link_url: linkUrl } : {}),
          ...(providerEventId ? { provider_event_id: providerEventId } : {}),
          ...(companyName ? { company_name: companyName } : {}),
          ...(contactName ? { contact_name: contactName } : {}),
          ...(phone ? { phone } : {}),
          ...(country ? { country } : {}),
          ...(sourceLeadId ? { source_lead_id: sourceLeadId } : {}),
        },
      };
    }),
  };
}

export function integrationV2ContentSha256(rawBody: Buffer) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function integrationV2Signature(secret: string, timestamp: string, rawBody: Buffer) {
  return createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex");
}

function safeEqualText(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyIntegrationV2Signature(args: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: Buffer;
  nowSeconds?: number;
}) {
  const { secret, timestamp, rawBody } = args;
  const signature = args.signature?.replace(/^sha256=/i, "").toLowerCase() ?? "";
  if (!secret || !timestamp || !/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > INTEGRATION_V2_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  return safeEqualText(integrationV2Signature(secret, timestamp, rawBody), signature);
}

export function integrationV2SourceSecret(sourceCode: string, rawSecrets: string | undefined) {
  if (!rawSecrets) return null;
  try {
    const parsed: unknown = JSON.parse(rawSecrets);
    if (!isObject(parsed)) return null;
    const secret = parsed[sourceCode.toLowerCase()];
    return typeof secret === "string" && secret.length >= 32 ? secret : null;
  } catch {
    return null;
  }
}

export function verifyIntegrationV2Bearer(expected: string | undefined, authorization: string | null) {
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  return safeEqualText(expected, authorization.slice(7));
}

export function verifyIntegrationV2WorkerAuthorization(
  authorization: string | null,
  workerSecret: string | undefined,
  cronSecret: string | undefined,
) {
  const workerMatches = verifyIntegrationV2Bearer(workerSecret, authorization);
  const cronMatches = verifyIntegrationV2Bearer(cronSecret, authorization);
  return workerMatches || cronMatches;
}

export type IntegrationV2Destination = { url: string; secret: string };

export function integrationV2Destinations(raw: string | undefined) {
  const destinations = new Map<string, IntegrationV2Destination>();
  if (!raw) return destinations;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return destinations;
    for (const [code, candidate] of Object.entries(parsed)) {
      if (!isObject(candidate) || typeof candidate.url !== "string" || typeof candidate.secret !== "string") continue;
      const url = new URL(candidate.url);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if ((url.protocol !== "https:" && !local) || candidate.secret.length < 32) continue;
      destinations.set(code.toLowerCase(), { url: url.toString(), secret: candidate.secret });
    }
  } catch {
    return destinations;
  }
  return destinations;
}

export type IntegrationV2OutboundItem = {
  event_id: string;
  event_type: string;
  created_at: string;
  payload: Record<string, unknown>;
};

function optionalPayloadText(payload: Record<string, unknown>, field: string, fallback: string) {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function outboundEntityVersion(item: IntegrationV2OutboundItem) {
  const supplied = item.payload.entity_version;
  if (Number.isSafeInteger(supplied) && Number(supplied) >= 1) return Number(supplied);
  return Math.max(1, Date.parse(item.created_at));
}

export function integrationV2OutboundBody(items: IntegrationV2OutboundItem[]) {
  return Buffer.from(JSON.stringify({
    schema_version: "2",
    items: items.map((item) => ({
      event_id: item.event_id,
      event_type: item.event_type,
      event_source: "urn:geimser:atlas2",
      subject: optionalPayloadText(item.payload, "subject", `urn:geimser:atlas2:${item.event_type}:${item.event_id}`),
      occurred_at: item.created_at,
      data_schema: optionalPayloadText(item.payload, "data_schema", `urn:geimser:schema:${item.event_type}`),
      tenant_id: optionalPayloadText(item.payload, "tenant_id", "geimser"),
      entity_version: outboundEntityVersion(item),
      correlation_id: optionalPayloadText(item.payload, "correlation_id", item.event_id),
      causation_id: typeof item.payload.causation_id === "string" && item.payload.causation_id.trim()
        ? item.payload.causation_id.trim()
        : null,
      external_key: optionalPayloadText(item.payload, "external_key", item.event_id),
      payload: item.payload,
    })),
  }));
}

export function integrationV2RetryDelaySeconds(attempt: number, seed: string) {
  const exponent = Math.min(Math.max(attempt - 1, 0), 6);
  const base = Math.min(900, 15 * (2 ** exponent));
  const jitterUnit = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) / 0xffffffff;
  return Math.max(5, Math.round(base * (0.8 + jitterUnit * 0.4)));
}

export function evaluateIntegrationV2Ack(
  status: number,
  value: unknown,
  expectedEventIds: string[],
) {
  if (status !== 202 || !isObject(value) || value.acknowledged !== true || !Array.isArray(value.accepted_event_ids)) {
    return { confirmed: [] as string[], missing: [...expectedEventIds] };
  }
  const accepted = new Set(value.accepted_event_ids.filter((candidate): candidate is string => typeof candidate === "string"));
  return {
    confirmed: expectedEventIds.filter((eventId) => accepted.has(eventId)),
    missing: expectedEventIds.filter((eventId) => !accepted.has(eventId)),
  };
}

export async function ringIntegrationV2Doorbell(args: {
  fallbackOrigin: string;
  path: "/api/integrations/v2/worker" | "/api/integrations/v2/outbox/dispatch";
  secret: string | undefined;
  limit: number;
}) {
  if (!args.secret || args.secret.length < 32) return false;
  const vercelHost = process.env.VERCEL_URL?.trim();
  const origin = vercelHost ? `https://${vercelHost}` : args.fallbackOrigin;
  const url = new URL(args.path, origin);
  if (!vercelHost && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${args.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: Math.min(Math.max(args.limit, 1), 250) }),
      redirect: "manual",
      signal: AbortSignal.timeout(1_200),
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export function partitionIntegrationV2Outbound<T extends IntegrationV2OutboundItem>(items: T[]) {
  const batches: T[][] = [];
  const oversized: T[] = [];
  let current: T[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (candidate.length <= INTEGRATION_V2_OUTBOUND_MAX_ITEMS && integrationV2OutboundBody(candidate).length <= INTEGRATION_V2_MAX_BYTES) {
      current = candidate;
      continue;
    }
    if (current.length) batches.push(current);
    if (integrationV2OutboundBody([item]).length > INTEGRATION_V2_MAX_BYTES) {
      oversized.push(item);
      current = [];
    } else {
      current = [item];
    }
  }
  if (current.length) batches.push(current);
  return { batches, oversized };
}
