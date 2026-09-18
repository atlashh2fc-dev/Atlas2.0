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

/**
 * Deja constancia de la corrida. Anotar no puede tumbar al agente: si la
 * bitácora falla, el trabajo ya está hecho y eso vale más que el registro.
 */
async function anotar(
  admin: ReturnType<typeof createAdminClient>,
  empresa: string,
  estado: "ok" | "alerta" | "error",
  resumen: string,
  detalle: Record<string, unknown>,
) {
  const { error } = await admin.rpc("anotar_corrida_de_agente", {
    p_agente: "calificador",
    p_organization_slug: empresa,
    p_estado: estado,
    p_resumen: resumen,
    p_detalle: detalle,
  });
  if (error) console.error(`[agente-calificador] no se pudo anotar la corrida: ${error.message}`);
}

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
      await anotar(admin, empresa, "error", `No pudo calificar: ${error.message}`, {});
      corridas.push({ empresa, error: error.message });
      continue;
    }

    const resultado = data as Record<string, unknown>;
    // Sin este rastro, un agente caído se ve igual que un día sin novedades.
    await anotar(
      admin,
      empresa,
      "ok",
      `${resultado.negocios_creados ?? 0} negocio(s) nuevos desde el interés en el correo`,
      resultado,
    );
    corridas.push(resultado);
  }

  return NextResponse.json({ ok: true, corridas });
}
