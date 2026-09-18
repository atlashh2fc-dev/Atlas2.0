import { NextResponse, type NextRequest } from "next/server";

import {
  proponerRespuesta,
  respuestasDeHoy,
  type ConfigVendedor,
  type RespuestaPendiente,
} from "@/lib/atlas-vendedor";
import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El latido de Atlas Vendedor.
 *
 * Cada quince minutos revisa si alguien respondió una campaña y, si es así,
 * redacta la contestación. En modo borrador la deja esperando aprobación; el
 * día que pase a autónomo, la misma propuesta se enviará sola.
 *
 * Tiene presupuesto: si ya redactó su cupo del día, se detiene y lo anota. Un
 * agente sin techo es un agente que un mal día escribe mil correos.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const EMPRESAS = ["altius"];
const POR_CORRIDA = 5;

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

  const apiKey = process.env.INCEPTION_API_KEY?.trim();
  const admin = createAdminClient();
  const salida: Record<string, unknown>[] = [];

  for (const empresa of EMPRESAS) {
    const anotar = async (estado: "ok" | "alerta" | "error", resumen: string, detalle: object = {}) => {
      await admin.rpc("anotar_corrida_de_agente", {
        p_agente: "vendedor",
        p_organization_slug: empresa,
        p_estado: estado,
        p_resumen: resumen,
        p_detalle: detalle,
      });
    };

    if (!apiKey) {
      await anotar("error", "Falta INCEPTION_API_KEY: el agente no puede redactar");
      salida.push({ empresa, error: "sin llave de IA" });
      continue;
    }

    const { data: configData } = await admin
      .from("sales_agent_configs")
      .select("*, organizations!inner(slug)")
      .eq("organizations.slug", empresa)
      .maybeSingle();

    const config = configData as unknown as ConfigVendedor | null;
    if (!config?.enabled) {
      salida.push({ empresa, estado: "apagado" });
      continue;
    }

    const yaHoy = await respuestasDeHoy(admin, config.organization_id);
    if (yaHoy >= config.max_respuestas_por_dia) {
      await anotar("alerta", `Llegó al tope del día: ${yaHoy} respuestas redactadas`);
      salida.push({ empresa, estado: "tope alcanzado", redactadas_hoy: yaHoy });
      continue;
    }

    const { data: pendientesData, error: errorPendientes } = await admin.rpc("respuestas_sin_atender", {
      p_organization_slug: empresa,
      p_limite: Math.min(POR_CORRIDA, config.max_respuestas_por_dia - yaHoy),
    });

    if (errorPendientes) {
      await anotar("error", `No pudo leer las respuestas: ${errorPendientes.message}`);
      salida.push({ empresa, error: errorPendientes.message });
      continue;
    }

    const pendientes = (pendientesData ?? []) as RespuestaPendiente[];
    if (pendientes.length === 0) {
      await anotar("ok", "Sin respuestas nuevas que contestar");
      salida.push({ empresa, estado: "sin novedades" });
      continue;
    }

    let redactadas = 0;
    let escaladas = 0;
    const fallas: string[] = [];

    for (const pendiente of pendientes) {
      try {
        const propuesta = await proponerRespuesta(config, pendiente, apiKey);

        // Quien pide la baja no recibe otra respuesta comercial: se escala y punto.
        const escalar = propuesta.escalar || propuesta.intencion === "baja" || !propuesta.responder;

        const { error } = await admin.rpc("guardar_borrador_de_venta", {
          p_organization_slug: empresa,
          p_mail_message_id: pendiente.mail_message_id,
          p_lead_id: pendiente.lead_id,
          p_opportunity_id: pendiente.opportunity_id,
          p_para_email: pendiente.de_email,
          p_asunto: propuesta.asunto,
          p_cuerpo: propuesta.cuerpo,
          p_intencion: propuesta.intencion,
          p_razonamiento: propuesta.razonamiento,
          p_escalar: escalar,
        });

        if (error) throw new Error(error.message);
        redactadas += 1;
        if (escalar) escaladas += 1;
      } catch (error) {
        const motivo = error instanceof Error ? error.message : "error desconocido";
        console.error(`[atlas-vendedor] ${empresa}: ${motivo}`);
        fallas.push(motivo);
      }
    }

    await anotar(
      fallas.length > 0 ? "alerta" : "ok",
      `${redactadas} respuesta(s) redactada(s), ${escaladas} para revisar contigo`,
      { redactadas, escaladas, fallas, modo: config.modo },
    );

    salida.push({ empresa, redactadas, escaladas, fallas, modo: config.modo });
  }

  return NextResponse.json({ ok: true, empresas: salida });
}
