import { NextRequest, NextResponse } from "next/server";

import { syncAllMailboxes } from "@/lib/inbound-mail";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await syncAllMailboxes();
    // Lo que llegó (y lo que venció sin dueño presente) entra al reparto de su
    // cola. Un fallo acá no invalida la sincronización: el próximo ciclo reparte.
    const { data: reparto, error: repartoError } = await createAdminClient().rpc("repartir_correos_pendientes");
    if (repartoError) console.error("[correo] no se pudo repartir la cola de correo", repartoError.message);
    return NextResponse.json({ ...result, reparto: reparto ?? null }, { status: result.errores.length && !result.resultados.length ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo sincronizar la casilla.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
