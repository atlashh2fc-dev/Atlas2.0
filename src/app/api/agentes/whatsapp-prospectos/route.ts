import { NextResponse, type NextRequest } from "next/server";

import { cronAutorizado } from "@/lib/cron-autorizado";
import { escribirAProspectos } from "@/lib/prospeccion-whatsapp.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El latido del WhatsApp automático a prospectos (ver
 * src/lib/prospeccion-whatsapp.ts). Corre cada veinte minutos en horario
 * hábil; con `?ensayo=1` no escribe nada y devuelve a quién le escribiría.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!cronAutorizado(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ensayo = request.nextUrl.searchParams.get("ensayo") === "1";
  const admin = createAdminClient();
  const anotar = async (estado: "ok" | "alerta" | "error", resumen: string, detalle: object = {}) => {
    if (ensayo) return;
    await admin.rpc("anotar_corrida_de_agente", {
      p_agente: "whatsapp",
      p_organization_slug: "altius",
      p_estado: estado,
      p_resumen: resumen,
      p_detalle: detalle,
    });
  };

  try {
    const informe = await escribirAProspectos({ ensayo });
    const alerta = informe.estado === "pausado" || informe.fallidos.length > 0;
    await anotar(alerta ? "alerta" : "ok", `WhatsApp automático · ${informe.resumen}`, informe);
    return NextResponse.json(informe);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Falló la corrida.";
    await anotar("error", `WhatsApp automático · ${detalle}`);
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
