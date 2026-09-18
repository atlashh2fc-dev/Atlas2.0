import { NextResponse, type NextRequest } from "next/server";

import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El vigilante: revisa el circuito completo y avisa siempre, aunque todo esté bien.
 *
 * Los dos fallos de esta semana no gritaron. La campaña enviaba cero correos y
 * decía "éxito"; el sincronizador del buzón reportaba verde sin credenciales. Un
 * sistema que trabaja solo no falla con una excepción: falla quedándose callado.
 *
 * Por eso el correo sale todos los días, haya o no problemas. Un informe que
 * solo llega cuando algo se rompe enseña a ignorar la bandeja: si hoy no llegó,
 * no se sabe si fue un buen día o si el vigilante también está muerto.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const EMPRESAS = ["altius"];

type Revision = { revision: string; estado: string; detalle: string };
type Verificacion = { empresa: string; alertas: number; avisos: number; revisiones: Revision[] };
type Resumen = Record<string, number | string>;

const SIGNOS: Record<string, string> = { ok: "✓", aviso: "!", alerta: "✕", sin_datos: "·" };
const COLORES: Record<string, string> = {
  ok: "#16794a",
  aviso: "#9a6700",
  alerta: "#b42318",
  sin_datos: "#64748b",
};

function escapar(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cuerpoHtml(empresa: string, verificacion: Verificacion, resumen: Resumen): string {
  const filas = verificacion.revisiones
    .map(
      (r) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${COLORES[r.estado] ?? "#334155"};font-weight:600;white-space:nowrap">
          ${SIGNOS[r.estado] ?? "·"} ${escapar(r.revision)}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#334155">${escapar(r.detalle)}</td>
      </tr>`,
    )
    .join("");

  const numero = (clave: string) => escapar(resumen[clave] ?? 0);

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#0f172a">
    <h2 style="margin:0 0 4px">Atlas · ${escapar(empresa)}</h2>
    <p style="margin:0 0 20px;color:#64748b;font-size:13px">Lo que hizo el equipo en las últimas 24 horas.</p>

    <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
      <tr>
        <td style="padding:10px 12px;background:#f8fafc;border-radius:6px">
          <strong style="font-size:22px">${numero("contactos_nuevos")}</strong><br>
          <span style="color:#64748b;font-size:12px">contactos nuevos</span>
        </td>
        <td style="padding:10px 12px;background:#f8fafc;border-radius:6px">
          <strong style="font-size:22px">${numero("aperturas")}</strong><br>
          <span style="color:#64748b;font-size:12px">aperturas</span>
        </td>
        <td style="padding:10px 12px;background:#f8fafc;border-radius:6px">
          <strong style="font-size:22px">${numero("clics")}</strong><br>
          <span style="color:#64748b;font-size:12px">clics</span>
        </td>
        <td style="padding:10px 12px;background:#f8fafc;border-radius:6px">
          <strong style="font-size:22px">${numero("negocios_nuevos")}</strong><br>
          <span style="color:#64748b;font-size:12px">negocios nuevos</span>
        </td>
        <td style="padding:10px 12px;background:#f8fafc;border-radius:6px">
          <strong style="font-size:22px">${numero("reuniones_agendadas")}</strong><br>
          <span style="color:#64748b;font-size:12px">reuniones</span>
        </td>
      </tr>
    </table>

    <h3 style="margin:0 0 8px;font-size:14px">Revisión del circuito</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">${filas}</table>

    <p style="margin:24px 0 0;color:#334155;font-size:13px">
      Hay <strong>${numero("negocios_abiertos")}</strong> negocios abiertos y
      <strong>${numero("para_hoy")}</strong> con acción para hoy.
    </p>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">
      Este correo llega todos los días, esté todo bien o no. Si un día no llega, el vigilante se cayó.
    </p>
  </div>`;
}

async function enviarInforme(asunto: string, html: string, destino: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { enviado: false, motivo: "Falta RESEND_API_KEY en el CRM" };

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REPORTE_FROM_EMAIL ?? "Atlas <reportes@altiusignite.com>",
      to: [destino],
      subject: asunto,
      html,
    }),
  });

  if (!respuesta.ok) {
    return { enviado: false, motivo: `Resend respondió ${respuesta.status}` };
  }
  return { enviado: true };
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
  const salida: Record<string, unknown>[] = [];

  // El informe va a quien responde por la plataforma, no a una dirección escrita a mano.
  const { data: duenios } = await admin
    .from("platform_owners")
    .select("profile_id, profiles(email)")
    .limit(1);
  const perfil = (duenios?.[0] as { profiles?: { email?: string } | { email?: string }[] } | undefined)?.profiles;
  const correoDuenio = Array.isArray(perfil) ? perfil[0]?.email : perfil?.email;
  const destino = process.env.REPORTE_TO_EMAIL ?? correoDuenio;

  for (const empresa of EMPRESAS) {
    const [verificacion, resumen] = await Promise.all([
      admin.rpc("verificar_procesos_de_empresa", { p_organization_slug: empresa }),
      admin.rpc("resumen_del_dia", { p_organization_slug: empresa }),
    ]);

    if (verificacion.error || resumen.error) {
      const motivo = verificacion.error?.message ?? resumen.error?.message ?? "error desconocido";
      console.error(`[vigilante] ${empresa}: ${motivo}`);
      // Que el vigilante falle es, en sí, la noticia más importante del día.
      if (destino) {
        await enviarInforme(
          `Atlas · ${empresa}: el vigilante no pudo revisar`,
          `<p>No se pudo completar la revisión: ${escapar(motivo)}</p>`,
          destino,
        );
      }
      await admin.rpc("anotar_corrida_de_agente", {
        p_agente: "vigilante",
        p_organization_slug: empresa,
        p_estado: "error",
        p_resumen: `No pudo revisar: ${motivo}`,
        p_detalle: {},
      });
      salida.push({ empresa, error: motivo });
      continue;
    }

    const datosVerificacion = verificacion.data as unknown as Verificacion;
    const datosResumen = resumen.data as unknown as Resumen;

    const asunto = datosVerificacion.alertas > 0
      ? `Atlas · ${empresa}: ${datosVerificacion.alertas} alerta(s) que revisar`
      : `Atlas · ${empresa}: todo en orden · ${datosResumen.negocios_nuevos ?? 0} negocios nuevos`;

    const envio = destino
      ? await enviarInforme(asunto, cuerpoHtml(empresa, datosVerificacion, datosResumen), destino)
      : { enviado: false, motivo: "No hay a quién enviarle el informe" };

    // Queda anotado el resultado y si el informe salió: sin esto, un correo que
    // no llega no distingue entre "el agente murió" y "el envío falló".
    await admin.rpc("anotar_corrida_de_agente", {
      p_agente: "vigilante",
      p_organization_slug: empresa,
      p_estado: datosVerificacion.alertas > 0 ? "alerta" : "ok",
      p_resumen: `${datosVerificacion.alertas} alerta(s); informe ${envio.enviado ? "enviado" : "no enviado"}`,
      p_detalle: { resumen: datosResumen, envio, revisiones: datosVerificacion.revisiones },
    });

    salida.push({ empresa, alertas: datosVerificacion.alertas, resumen: datosResumen, envio });
  }

  return NextResponse.json({ ok: true, empresas: salida });
}
