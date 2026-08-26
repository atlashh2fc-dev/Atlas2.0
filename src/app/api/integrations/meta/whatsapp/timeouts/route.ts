import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("close_inactive_whatsapp_conversations");
  if (error) {
    console.error("whatsapp_timeout_closure_failed", { message: error.message });
    return NextResponse.json({ error: "No se pudo procesar el cierre por inactividad." }, { status: 500 });
  }
  return NextResponse.json({ closed: typeof data === "number" ? data : 0 });
}
