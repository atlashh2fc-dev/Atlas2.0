import { NextResponse, type NextRequest } from "next/server";

import {
  armarInformeDeMarketing,
  type AgenteDelInforme,
  type DatosDelInforme,
  type EventoDelInforme,
  type PiezaDelInforme,
} from "@/lib/informe-marketing";
import { verifyIntegrationV2WorkerAuthorization } from "@/lib/integration-v2";
import { resumenDeCorreo } from "@/lib/marketing-correo.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El vigilante: revisa el circuito completo y avisa siempre, aunque todo esté bien.
 *
 * Los dos fallos de esta semana no gritaron. La campaña enviaba cero correos y
 * decía "éxito"; el sincronizador del buzón reportaba verde sin credenciales. Un
 * sistema que trabaja solo no falla con una excepción: falla quedándose callado.
 *
 * Desde el 04-10-2026 el correo es el informe diario de marketing completo
 * (src/lib/informe-marketing.ts): correo, grupos, Reels, respuestas, decisiones
 * del equipo de agentes y, al final, esta revisión del circuito.
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

const escapar = (valor: unknown): string =>
  String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const HORA = 3_600_000;
const NOMBRE_DE_EMPRESA: Record<string, string> = { altius: "Altius" };
/** Publicaciones en grupos comprometidas por día (mínimo que pidió la dirección). */
const META_GRUPOS = Number(process.env.ORBITA_META_GRUPOS) || 20;

/**
 * Todo lo que el informe muestra, leído de una vez: el calendario de Marketing
 * (lo comprometido y lo hecho), la red de Órbita (equipo, decisiones, alertas),
 * el correo (por el puente con Atlas Lead) y las ventas.
 */
async function datosDelInforme(
  admin: ReturnType<typeof createAdminClient>,
  empresa: string,
  verificacion: Verificacion,
  resumen: Resumen,
): Promise<DatosDelInforme> {
  const ahora = new Date();
  const hace24 = new Date(ahora.getTime() - 24 * HORA).toISOString();
  const en24 = new Date(ahora.getTime() + 24 * HORA).toISOString();
  const { data: organizationId } = await admin.rpc("organization_id_by_slug", { p_slug: empresa });
  const COLUMNAS = "title, channel, format, status, agent, target, body, scheduled_at, published_at, external_id";

  const [correo, piezas, proximas, agentes, eventos, analisis] = await Promise.all([
    resumenDeCorreo(empresa),
    admin.from("marketing_items").select(COLUMNAS).eq("organization_id", organizationId).gte("scheduled_at", hace24).lte("scheduled_at", ahora.toISOString()).order("scheduled_at").limit(400),
    admin.from("marketing_items").select(COLUMNAS).eq("organization_id", organizationId).gt("scheduled_at", ahora.toISOString()).lte("scheduled_at", en24).order("scheduled_at").limit(200),
    admin.from("orbita_agentes").select("codigo, nombre, persona, motor, activo, ultimo_estado, ultimo_evento_at, ultimo_resumen").eq("organization_id", organizationId).order("codigo"),
    admin.from("orbita_eventos").select("agente_codigo, tipo, resumen, relacionado_con, ocurrido_at").eq("organization_id", organizationId).neq("tipo", "pulso").gte("ocurrido_at", hace24).order("ocurrido_at", { ascending: false }).limit(200),
    admin.from("orbita_notas").select("titulo, contenido, created_at").eq("organization_id", organizationId).in("tipo", ["reporte", "retrospectiva"]).gte("created_at", new Date(ahora.getTime() - 36 * HORA).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const equipo = ((agentes.data ?? []) as AgenteDelInforme[]).sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
  // Mientras el Líder no escriba en la memoria de la nube, vale su último resumen.
  const lider = equipo.find((agente) => agente.codigo === "7");
  const liderReciente = lider?.ultimo_resumen && lider.ultimo_evento_at && Date.parse(lider.ultimo_evento_at) > ahora.getTime() - 36 * HORA;

  return {
    empresa: NOMBRE_DE_EMPRESA[empresa] ?? empresa,
    ahora: ahora.toISOString(),
    correo: correo.ok ? correo.datos : null,
    correoError: correo.ok ? null : correo.error,
    piezas: (piezas.data ?? []) as PiezaDelInforme[],
    proximas: (proximas.data ?? []) as PiezaDelInforme[],
    agentes: equipo,
    eventos: (eventos.data ?? []) as EventoDelInforme[],
    analisis: analisis.data
      ? (analisis.data as { titulo: string; contenido: string; created_at: string })
      : liderReciente
        ? { titulo: `Último informe de ${lider.persona ?? lider.nombre} (${lider.nombre})`, contenido: lider.ultimo_resumen as string, created_at: lider.ultimo_evento_at as string }
        : null,
    ventas: resumen,
    revisiones: verificacion.revisiones,
    metaGrupos: META_GRUPOS,
  };
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
    const [verificacion, resumen, delVendedor] = await Promise.all([
      admin.rpc("verificar_procesos_de_empresa", { p_organization_slug: empresa }),
      admin.rpc("resumen_del_dia", { p_organization_slug: empresa }),
      admin.rpc("revisiones_del_vendedor", { p_organization_slug: empresa }),
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

    // Las revisiones del vendedor van en el mismo informe: un agente que redacta
    // y nadie revisa es un prospecto esperando, y eso no puede quedar en otra parte.
    const revisionesVendedor = (delVendedor.data ?? []) as Revision[];
    datosVerificacion.revisiones = [...datosVerificacion.revisiones, ...revisionesVendedor];
    datosVerificacion.alertas += revisionesVendedor.filter((r) => r.estado === "alerta").length;

    // Un solo informe de marketing: lo comprometido, lo hecho y lo que volvió
    // en todos los canales, con el circuito al final.
    const informe = armarInformeDeMarketing(await datosDelInforme(admin, empresa, datosVerificacion, datosResumen));

    const envio = destino
      ? await enviarInforme(informe.asunto, informe.html, destino)
      : { enviado: false, motivo: "No hay a quién enviarle el informe" };

    // Queda anotado el resultado y si el informe salió: sin esto, un correo que
    // no llega no distingue entre "el agente murió" y "el envío falló".
    await admin.rpc("anotar_corrida_de_agente", {
      p_agente: "vigilante",
      p_organization_slug: empresa,
      p_estado: datosVerificacion.alertas > 0 ? "alerta" : "ok",
      p_resumen: `${datosVerificacion.alertas} alerta(s); informe ${envio.enviado ? "enviado" : "no enviado"}`,
      p_detalle: { resumen: datosResumen, envio, revisiones: datosVerificacion.revisiones, puntos_del_informe: informe.alertas },
    });

    salida.push({ empresa, alertas: datosVerificacion.alertas, resumen: datosResumen, envio });
  }

  return NextResponse.json({ ok: true, empresas: salida });
}
