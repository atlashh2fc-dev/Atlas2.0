import { NextResponse, type NextRequest } from "next/server";

import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Agente calificador: convierte interés en trabajo concreto.
 *
 * Alguien abre el correo de una campaña o hace clic, y esa señal se queda en
 * una casilla de la pantalla de Correo hasta que se enfría. Este agente corre
 * solo y crea el negocio en el embudo, con su próxima acción y su fecha, para
 * que mañana exista alguien a quien escribirle.
 *
 * La decisión de qué hacer con cada señal vive en la base, no acá: esta ruta
 * solo despierta al agente y cuenta lo que hizo.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** Empresas que tienen el agente encendido. Se amplía cuando otra lo contrate. */
const EMPRESAS = ["altius"];

export async function GET(request: NextRequest) {
  if (
    !verifyIntegrationV2WorkerAuthorization(
      request.headers.get("authorization"),
      process.env.INTEGRATION_WORKER_SECRET,
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const corridas: Record<string, unknown>[] = [];

  for (const empresa of EMPRESAS) {
    const { data, error } = await admin.rpc("calificar_interes_de_correo", {
      p_organization_slug: empresa,
      p_limite: 50,
    });

    if (error) {
      // Una empresa que falla no puede dejar sin correr a las demás.
      console.error(`[agente-calificador] ${empresa}: ${error.message}`);
      corridas.push({ empresa, error: error.message });
      continue;
    }

    corridas.push(data as Record<string, unknown>);
  }

  return NextResponse.json({ ok: true, corridas });
}
