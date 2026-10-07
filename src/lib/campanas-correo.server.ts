import "server-only";

import type {
  CampanaDetalle,
  CorreoSinAsociar,
  Capacidades,
  ConteoAudiencia,
  FiltrosAudiencia,
  ListaDeCampanas,
  OpcionesAudiencia,
} from "./campanas-correo";
import { integrationV2Destinations, integrationV2Signature } from "./integration-v2";
import { llamarAtlasLead, type Resultado } from "./marketing-correo.server";
import { createClient } from "./supabase/server";

/*
 * Campañas de correo orquestadas desde el CRM.
 *
 * Atlas Lead (puente /api/integrations/v2/crm/*) guarda, valida, envía y mide.
 * Bigdata (bigdata.audiencia.v1) filtra la base y entrega la audiencia. El CRM
 * no guarda copia de la campaña: la lee de Atlas Lead cada vez, así la consola
 * de Atlas Lead y el CRM nunca muestran dos versiones distintas.
 */

/** Slug de la empresa que la persona está mirando: es la empresa en Atlas Lead. */
export async function empresaActual(): Promise<{ id: string; slug: string; nombre: string } | null> {
  const supabase = await createClient();
  const { data: orgId } = await supabase.rpc("current_org_id");
  if (!orgId) return null;
  const { data } = await supabase.from("organizations").select("id, slug, name").eq("id", orgId as string).maybeSingle();
  if (!data?.slug) return null;
  return { id: data.id as string, slug: data.slug as string, nombre: (data.name as string | null) ?? (data.slug as string) };
}

export type AccionAtlasLead =
  | "conectar"
  | "capacidades"
  | "listar"
  | "detalle"
  | "guardar"
  | "ajustar"
  | "vista_previa"
  | "prueba"
  | "estado"
  | "audiencia"
  | "imagen"
  | "sin_asociar"
  | "resolver_sin_asociar";

const TIEMPO_POR_ACCION: Partial<Record<AccionAtlasLead, number>> = {
  prueba: 90_000,
  audiencia: 60_000,
  vista_previa: 30_000,
};

export function atlasLead<T>(slug: string, accion: AccionAtlasLead, cuerpo: Record<string, unknown> = {}): Promise<Resultado<T>> {
  return llamarAtlasLead<T>(`/api/integrations/v2/crm/${accion}`, { ...cuerpo, empresa: slug }, TIEMPO_POR_ACCION[accion] ?? 20_000);
}

export const capacidadesDeCorreo = (slug: string) => atlasLead<Capacidades>(slug, "capacidades");
export const campanasDeCorreo = (slug: string) => atlasLead<ListaDeCampanas>(slug, "listar");
export const campanaDeCorreo = (slug: string, id: string) => atlasLead<{ campana: CampanaDetalle }>(slug, "detalle", { campana_id: id });
export const correosSinAsociar = (slug: string) => atlasLead<{ total: number; correos: CorreoSinAsociar[] }>(slug, "sin_asociar");

// ---------------------------------------------------------------------------
// Bigdata

const CONTRATO_AUDIENCIA = "bigdata.audiencia.v1";

async function llamarBigdata<T>(cuerpo: Record<string, unknown>): Promise<Resultado<T>> {
  const destino = integrationV2Destinations(process.env.INTEGRATION_OUTBOX_DESTINATIONS_JSON).get("bigdata");
  if (!destino) return { ok: false, error: "El puente con Bigdata no está configurado." };

  const rawBody = JSON.stringify({ contract: CONTRATO_AUDIENCIA, ...cuerpo });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  try {
    const respuesta = await fetch(new URL("/api/commercial-intelligence/atlas-bridge/audiencia", destino.url), {
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
      signal: AbortSignal.timeout(30_000),
    });
    const datos = (await respuesta.json().catch(() => null)) as (T & { error?: string }) | null;
    if (respuesta.status === 404 && !datos) return { ok: false, status: 404, error: "Bigdata todavía no entrega audiencias." };
    if (!respuesta.ok || !datos) {
      return { ok: false, status: respuesta.status, error: datos?.error ?? `Bigdata respondió ${respuesta.status}.` };
    }
    return { ok: true, datos };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "Bigdata no respondió a tiempo." : "No se pudo conectar con Bigdata." };
  }
}

export const opcionesDeAudiencia = (filtros: FiltrosAudiencia) => llamarBigdata<OpcionesAudiencia>({ accion: "opciones", filtros });
export const conteoDeAudiencia = (filtros: FiltrosAudiencia) => llamarBigdata<ConteoAudiencia>({ accion: "contar", filtros });

export type FilaDeAudiencia = {
  referencia: string;
  rut: string | null;
  empresa: string | null;
  email: string;
  origen: "ejecutivo" | "empresa";
  nombre: string | null;
  cargo: string | null;
  area: string | null;
  telefono: string | null;
  region: string | null;
  comuna: string | null;
  rubro: string | null;
};

export const paginaDeAudiencia = (filtros: FiltrosAudiencia, despues: string | null, limite: number) =>
  llamarBigdata<{ filas: FilaDeAudiencia[]; siguiente: string | null; bloqueados: number }>({ accion: "pagina", filtros, despues, limite });
