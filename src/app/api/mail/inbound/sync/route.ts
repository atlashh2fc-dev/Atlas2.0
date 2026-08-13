import { NextRequest, NextResponse } from "next/server";

import { syncAbogadoLegalInbox } from "@/lib/inbound-mail";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await syncAbogadoLegalInbox();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar la casilla.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
