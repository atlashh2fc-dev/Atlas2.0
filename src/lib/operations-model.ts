/** Operational metadata only. Do not add message bodies, notes or contact PII. */
export type OperationalConversation = {
  id: string;
  queue_id: string | null;
  campaign_id: string;
  assigned_to: string | null;
  status: "open" | "pending" | "closed";
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
};

export type ConversationStock = {
  total: number;
  open: number;
  pending: number;
  unassigned: number;
  awaitingResponse: number;
  oldestUnansweredAt: string | null;
};

export function isAwaitingResponse(item: OperationalConversation): boolean {
  if (item.status === "closed" || !item.last_inbound_at) return false;
  const inbound = Date.parse(item.last_inbound_at);
  if (!Number.isFinite(inbound)) return false;
  if (!item.last_outbound_at) return true;
  const outbound = Date.parse(item.last_outbound_at);
  return Number.isFinite(outbound) && inbound > outbound;
}

export function summarizeConversationStock(
  items: OperationalConversation[],
): ConversationStock {
  const stock: ConversationStock = {
    total: 0,
    open: 0,
    pending: 0,
    unassigned: 0,
    awaitingResponse: 0,
    oldestUnansweredAt: null,
  };
  for (const item of items) {
    if (item.status === "closed") continue;
    stock.total += 1;
    stock[item.status] += 1;
    if (!item.assigned_to) stock.unassigned += 1;
    if (isAwaitingResponse(item)) {
      stock.awaitingResponse += 1;
      if (
        !stock.oldestUnansweredAt ||
        Date.parse(item.last_inbound_at!) < Date.parse(stock.oldestUnansweredAt)
      ) {
        stock.oldestUnansweredAt = item.last_inbound_at;
      }
    }
  }
  return stock;
}

/** This is elapsed time since the latest inbound, not a certified SLA metric. */
export function formatOperationalAge(
  timestamp: string | null,
  now: number,
): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "—";
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(timestamp)) / 60_000),
  );
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440)
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}

export type OperationFilters = {
  channel: "all" | "voice" | "whatsapp";
  campaign: string;
  queue: string;
  state: "all" | "active" | "inactive";
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOperationFilters(
  params: Record<string, string | string[] | undefined>,
): OperationFilters {
  return {
    channel:
      params.channel === "voice" || params.channel === "whatsapp"
        ? params.channel
        : "all",
    campaign:
      typeof params.campaign === "string" && UUID.test(params.campaign)
        ? params.campaign
        : "",
    queue:
      typeof params.queue === "string" && UUID.test(params.queue)
        ? params.queue
        : "",
    state:
      params.state === "active" || params.state === "inactive"
        ? params.state
        : "all",
  };
}
