import { NextRequest, NextResponse } from "next/server";

import { respondToWhatsAppInbound } from "@/lib/mercury-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_whatsapp_ai_work", { p_limit: 20 });
  if (error) {
    console.error("whatsapp_ai_worker_query_failed", { message: error.message.slice(0, 500) });
    return NextResponse.json({ error: "No se pudo recuperar el trabajo pendiente." }, { status: 500 });
  }

  const candidates = (data ?? []) as Array<{ conversation_id: string; inbound_message_id: string }>;
  const settled = await Promise.allSettled(candidates.map((candidate) => respondToWhatsAppInbound({
    conversationId: candidate.conversation_id,
    inboundMessageId: candidate.inbound_message_id,
  })));
  return NextResponse.json({
    candidates: candidates.length,
    fulfilled: settled.filter((result) => result.status === "fulfilled").length,
    rejected: settled.filter((result) => result.status === "rejected").length,
  });
}
