import { NextResponse, type NextRequest } from "next/server";

import { despacharMensajes } from "@/lib/mensajes/despachar";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected) && supplied === expected;
}

/**
 * El cron de mensajes: cada diez minutos genera los recordatorios que tocan
 * hoy y despacha lo programado. Sin sesión web; exige el secreto del cron.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const resultado = await despacharMensajes({ generar: true, limite: 100 });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fallo al despachar mensajes.";
    console.error("[mensajes] despacho fallido", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
