import "server-only";

import type { ResumenDeCorreo } from "./informe-marketing";
import { integrationV2Destinations, integrationV2Signature } from "./integration-v2";

/**
 * El correo de marketing vive en Atlas Lead (campañas, envíos, respuestas).
 * Acá Atlas lo lee y lo ajusta por el puente firmado que ya existe, para el
 * informe diario y para el cerebro de marketing (Órbita): un solo lugar que
 * orquesta todos los canales.
 */

/** La marca con que cada empresa envía en Atlas Lead. */
const MARCA_POR_EMPRESA: Record<string, string> = { altius: "Altius Ignite" };

export function marcaDeLaEmpresa(slug: string): string | null {
  return MARCA_POR_EMPRESA[slug] ?? null;
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

async function llamar<T>(ruta: string, cuerpo: Record<string, unknown>): Promise<Resultado<T>> {
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
      signal: AbortSignal.timeout(20_000),
    });
    const datos = (await respuesta.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!respuesta.ok || !datos) return { ok: false, error: `Atlas Lead respondió ${respuesta.status}${datos?.error ? `: ${datos.error}` : ""}` };
    return { ok: true, datos };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "Atlas Lead no respondió a tiempo" : "no se pudo conectar con Atlas Lead" };
  }
}

/** Lo planificado, lo enviado y lo que volvió, por campaña de correo. */
export async function resumenDeCorreo(slug: string): Promise<Resultado<ResumenDeCorreo>> {
  const marca = marcaDeLaEmpresa(slug);
  if (!marca) return { ok: false, error: "la empresa no tiene una marca de correo configurada" };
  const resultado = await llamar<ResumenDeCorreo>("/api/integrations/v2/marketing/resumen", { marca });
  if (!resultado.ok) return resultado;
  const datos = resultado.datos;
  return {
    ok: true,
    datos: {
      marca: datos.marca ?? marca,
      enviados_hoy: Number(datos.enviados_hoy) || 0,
      cupo_diario: typeof datos.cupo_diario === "number" ? datos.cupo_diario : null,
      campanas: Array.isArray(datos.campanas) ? datos.campanas : [],
      respuestas_7d: Array.isArray(datos.respuestas_7d) ? datos.respuestas_7d : [],
    },
  };
}

export type AjusteDeCampana = { campana_id: string; activa?: boolean; limite_diario?: number };

/** Activa, pausa o cambia el límite diario de una campaña de la marca. */
export async function ajustarCampanaDeCorreo(slug: string, ajuste: AjusteDeCampana) {
  const marca = marcaDeLaEmpresa(slug);
  if (!marca) return { ok: false as const, error: "la empresa no tiene una marca de correo configurada" };
  return llamar<{ ok: true; campana: { id: string; nombre: string; activa: boolean; limite_diario: number | null } }>(
    "/api/integrations/v2/marketing/campana",
    { marca, ...ajuste },
  );
}
