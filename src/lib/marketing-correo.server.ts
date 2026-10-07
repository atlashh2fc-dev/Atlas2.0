import "server-only";

import type { ResumenDeCorreo } from "./informe-marketing";
import { integrationV2Destinations, integrationV2Signature } from "./integration-v2";

/**
 * El correo de marketing vive en Atlas Lead (campañas, envíos, respuestas).
 * Acá Atlas lo lee y lo ajusta por el puente firmado que ya existe, para el
 * informe diario y para el cerebro de marketing (Órbita): un solo lugar que
 * orquesta todos los canales.
 */

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string; status?: number };

/**
 * Llamada firmada al puente de Atlas Lead (mismo destino y secreto del outbox).
 * La empresa siempre viaja en el cuerpo firmado: Atlas Lead solo deja ver y
 * tocar lo de esa empresa.
 */
export async function llamarAtlasLead<T>(ruta: string, cuerpo: Record<string, unknown>, timeoutMs = 20_000): Promise<Resultado<T>> {
  const destino = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON).get("atlas_lead");
  if (!destino) return { ok: false, error: "el puente con Atlas Lead no está configurado" };

  const rawBody = JSON.stringify(cuerpo);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const respuesta = await fetch(new URL(ruta, destino.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-source": "atlas2",
        "x-atlas-timestamp": timestamp,
        "x-atlas-signature": integrationV2Signature(destino.secret, timestamp, Buffer.from(rawBody)),
      },
      body: rawBody,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const datos = (await respuesta.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!respuesta.ok || !datos) {
      // Los errores de validación de Atlas Lead ya vienen en palabras para la pantalla.
      const legible = respuesta.status === 400 || respuesta.status === 404 || respuesta.status === 409 || respuesta.status === 422;
      return {
        ok: false,
        status: respuesta.status,
        error: legible && datos?.error ? datos.error : `Atlas Lead respondió ${respuesta.status}${datos?.error ? `: ${datos.error}` : ""}`,
      };
    }
    return { ok: true, datos };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "Atlas Lead no respondió a tiempo" : "no se pudo conectar con Atlas Lead" };
  }
}

/** Lo planificado, lo enviado y lo que volvió, por campaña de correo de la empresa. */
export async function resumenDeCorreo(slug: string): Promise<Resultado<ResumenDeCorreo>> {
  const resultado = await llamarAtlasLead<ResumenDeCorreo>("/api/integrations/v2/marketing/resumen", { empresa: slug });
  if (!resultado.ok) return resultado;
  const datos = resultado.datos;
  return {
    ok: true,
    datos: {
      marca: datos.marca ?? slug,
      enviados_hoy: Number(datos.enviados_hoy) || 0,
      cupo_diario: typeof datos.cupo_diario === "number" ? datos.cupo_diario : null,
      campanas: Array.isArray(datos.campanas) ? datos.campanas : [],
      respuestas_7d: Array.isArray(datos.respuestas_7d) ? datos.respuestas_7d : [],
      por_dia: Array.isArray(datos.por_dia)
        ? datos.por_dia.map((d) => ({
            dia: String(d.dia),
            enviados: Number(d.enviados) || 0,
            fallidos: Number(d.fallidos) || 0,
            abrieron: Number(d.abrieron) || 0,
            clics: Number(d.clics) || 0,
            rebotes: Number(d.rebotes) || 0,
            respuestas: Number(d.respuestas) || 0,
            bajas: Number(d.bajas) || 0,
          }))
        : [],
    },
  };
}

export type AjusteDeCampana = { campana_id: string; activa?: boolean; limite_diario?: number };

/** Activa, pausa o cambia el límite diario de una campaña de la empresa. */
export async function ajustarCampanaDeCorreo(slug: string, ajuste: AjusteDeCampana) {
  return llamarAtlasLead<{ ok: true; campana: { id: string; nombre: string; activa: boolean; limite_diario: number | null } }>(
    "/api/integrations/v2/marketing/campana",
    { empresa: slug, ...ajuste },
  );
}
