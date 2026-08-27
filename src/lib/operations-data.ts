import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { OperationalConversation } from "@/lib/operations-model";

export const OPERATIONAL_CONVERSATION_COLUMNS =
  "id, queue_id, campaign_id, assigned_to, status, last_inbound_at, last_outbound_at, last_message_at";
const PAGE_SIZE = 1000;
const MAX_ROWS = 5_000;

/** Use the authenticated client/RLS. Fail closed on partial data; never show a
 * truncated stock as the full total. The cap prevents an unbounded scan. */
export async function loadOperationalConversations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: { campaign: string; queue: string },
): Promise<{ data: OperationalConversation[] | null; error: string | null }> {
  const rows: OperationalConversation[] = [];
  let expectedCount: number | null = null;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = supabase
      .from("whatsapp_conversations")
      .select(OPERATIONAL_CONVERSATION_COLUMNS, { count: "exact" })
      .in("status", ["open", "pending"])
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (filters.campaign) query = query.eq("campaign_id", filters.campaign);
    if (filters.queue) query = query.eq("queue_id", filters.queue);
    const result = await query;
    if (result.error || result.count === null || !result.data) {
      return {
        data: null,
        error:
          "No fue posible consultar el stock de WhatsApp. Reintenta o revisa los permisos de acceso.",
      };
    }
    if (result.count > MAX_ROWS)
      return {
        data: null,
        error:
          "El stock supera el límite de consulta. Selecciona una campaña o cola para obtener un total completo.",
      };
    if (expectedCount !== null && expectedCount !== result.count) {
      return {
        data: null,
        error:
          "El stock cambió durante la consulta. Actualiza para obtener una instantánea completa.",
      };
    }
    expectedCount = result.count;
    rows.push(...(result.data as OperationalConversation[]));
    if (rows.length >= result.count) return { data: rows, error: null };
    if (result.data.length < PAGE_SIZE)
      return {
        data: null,
        error:
          "La consulta devolvió datos incompletos. Selecciona una campaña o vuelve a intentar.",
      };
  }
  return { data: null, error: "No fue posible obtener el stock completo." };
}
