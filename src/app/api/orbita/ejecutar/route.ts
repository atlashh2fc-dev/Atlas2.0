import { after, NextResponse } from "next/server";

import { cronAutorizado } from "@/lib/cron-autorizado";
import { tomarTurno } from "@/lib/orbita-turno.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lanza a mano un turno de un agente de Órbita en la nube.
 *
 * El reloj ya no pasa por acá (corre los turnos dentro de su propia función);
 * esta ruta queda para relanzar una ejecución pendiente con CRON_SECRET. Toma
 * la ejecución solo si sigue pendiente, responde al tiro y trabaja después.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!cronAutorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let ejecucionId: string | null = null;
  try {
    const cuerpo = (await request.json()) as { ejecucion_id?: unknown };
    ejecucionId = typeof cuerpo.ejecucion_id === "string" ? cuerpo.ejecucion_id : null;
  } catch {
    ejecucionId = null;
  }
  if (!ejecucionId) return NextResponse.json({ error: "Falta ejecucion_id" }, { status: 400 });

  const turno = await tomarTurno(createAdminClient(), ejecucionId);
  if (!turno.tomada) {
    return turno.error ? NextResponse.json({ error: turno.error }, { status: 422 }) : NextResponse.json({ ok: true, estado: "ya tomada" }, { status: 200 });
  }
  after(turno.trabajo);
  return NextResponse.json({ ok: true, estado: "corriendo", agente: turno.agente, intento: turno.intento }, { status: 202 });
}
