import "server-only";

import {
  VERIFICACIONES_POR_CORRIDA,
  consultasDeVerificacion,
  esRelevante,
  parsearBing,
  parsearDuckDuckGo,
  pistaDelCorreo,
  resultadosDesdeGooglePlaces,
  rubroDeLaCampana,
  verificacionVigente,
  veredicto,
  type ResultadoWeb,
  type Verificacion,
} from "@/lib/verificacion-prospecto";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * La parte con red de la verificación (reglas en verificacion-prospecto.ts):
 * busca el negocio, decide y guarda el veredicto en
 * leads.extra.verificacion_whatsapp. Si el número era un fijo mal convertido,
 * corrige leads.phone y deja el anterior anotado.
 *
 * Con GOOGLE_PLACES_API_KEY se pregunta a Google Places (searchText, región
 * CL): devuelve el tipo de negocio, el teléfono y las reseñas, y no se cansa.
 * Sin clave, DuckDuckGo y Bing como un navegador: DuckDuckGo responde 202 sin
 * resultados cuando se le pregunta muy seguido (de ahí la pausa) y Bing
 * encuentra menos; lo que no aparece queda pendiente, no sale.
 */

type Admin = ReturnType<typeof createAdminClient>;

const NAVEGADOR = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PAUSA_ENTRE_BUSQUEDAS_MS = 1200;
const TIEMPO_MAXIMO_MS = 9000;

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function descargar(url: string): Promise<{ status: number; html: string }> {
  const respuesta = await fetch(url, {
    headers: { "user-agent": NAVEGADOR, "accept-language": "es-CL,es;q=0.9", accept: "text/html" },
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    cache: "no-store",
  });
  return { status: respuesta.status, html: await respuesta.text() };
}

const CAMPOS_DE_GOOGLE = "places.displayName,places.formattedAddress,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.businessStatus";

export const hayGooglePlaces = () => Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());

/** Google Places (API nueva): hasta 5 lugares de Chile que respondan a la consulta. Lanza si Google falla. */
async function buscarEnGooglePlaces(consulta: string): Promise<ResultadoWeb[]> {
  const clave = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!clave) return [];
  const respuesta = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": clave, "x-goog-fieldmask": CAMPOS_DE_GOOGLE },
    body: JSON.stringify({ textQuery: consulta, regionCode: "CL", languageCode: "es", pageSize: 5 }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    cache: "no-store",
  });
  const datos = (await respuesta.json().catch(() => ({}))) as { places?: Parameters<typeof resultadosDesdeGooglePlaces>[0]; error?: { message?: string } };
  if (!respuesta.ok) throw new Error(`Google Places: ${datos.error?.message ?? `error ${respuesta.status}`}`);
  return resultadosDesdeGooglePlaces(datos.places);
}

/** Una consulta: Google Places si hay clave; si no (o si Google no encuentra nada), DuckDuckGo y después Bing. */
export async function buscarEnLaWeb(consulta: string): Promise<{ resultados: ResultadoWeb[]; buscador: string }> {
  if (hayGooglePlaces()) {
    try {
      const resultados = await buscarEnGooglePlaces(consulta);
      if (resultados.length > 0) return { resultados, buscador: "google-places" };
    } catch (error) {
      console.warn("[verificacion] google places falló", error instanceof Error ? error.message : error);
    }
  }
  try {
    const { status, html } = await descargar(`https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: consulta, kl: "cl-es" })}`);
    const resultados = status === 200 ? parsearDuckDuckGo(html) : [];
    if (resultados.length > 0) return { resultados, buscador: "duckduckgo" };
  } catch (error) {
    console.warn("[verificacion] duckduckgo no respondió", error instanceof Error ? error.message : error);
  }
  try {
    const { status, html } = await descargar(`https://www.bing.com/search?${new URLSearchParams({ q: consulta, cc: "CL", setlang: "es" })}`);
    return { resultados: status === 200 ? parsearBing(html) : [], buscador: "bing" };
  } catch (error) {
    console.warn("[verificacion] bing no respondió", error instanceof Error ? error.message : error);
    return { resultados: [], buscador: "ninguno" };
  }
}

export type ProspectoAVerificar = {
  leadId: string;
  empresa: string | null;
  email: string | null;
  celular: string | null;
  campana: string | null;
};

/** Busca al negocio (una o dos consultas) y devuelve el veredicto. Lanza si ningún buscador respondió. */
export async function verificarProspecto(prospecto: ProspectoAVerificar, ahora = new Date()): Promise<Verificacion> {
  const rubro = rubroDeLaCampana(prospecto.campana);
  const pista = pistaDelCorreo(prospecto.email);
  const resultados: ResultadoWeb[] = [];
  const buscadores = new Set<string>();
  let respondio = false;
  for (const [i, consulta] of consultasDeVerificacion({ empresa: prospecto.empresa, email: prospecto.email, rubro }).entries()) {
    if (i > 0) {
      if (resultados.some((r) => esRelevante(r, { empresa: prospecto.empresa, pista }))) break;
      if (!hayGooglePlaces()) await esperar(PAUSA_ENTRE_BUSQUEDAS_MS);
    }
    const { resultados: nuevos, buscador } = await buscarEnLaWeb(consulta);
    if (buscador !== "ninguno") respondio = true;
    buscadores.add(buscador);
    resultados.push(...nuevos);
  }
  if (!respondio) throw new Error("Ningún buscador respondió.");
  return veredicto({ empresa: prospecto.empresa, email: prospecto.email, celular: prospecto.celular, rubro, resultados, ahora, fuente: [...buscadores].filter((b) => b !== "ninguno").join("+") });
}

export type ResultadoDeVerificacion = { empresa: string | null; estado: Verificacion["estado"]; motivo: string; nueva: boolean };

/**
 * Deja verificados a los candidatos del día, en orden, hasta juntar `cupo`
 * aprobados o agotar las verificaciones nuevas de esta corrida. Devuelve a
 * quiénes se les puede escribir y, para los corregidos, el celular bueno.
 * En ensayo busca igual pero no guarda nada.
 */
export async function verificarCandidatos(
  admin: Admin,
  org: string,
  candidatos: { leadId: string; empresa: string | null; celular: string }[],
  { cupo, ensayo, ahora = new Date() }: { cupo: number; ensayo: boolean; ahora?: Date },
): Promise<{ aprobados: Map<string, string>; informe: ResultadoDeVerificacion[] }> {
  const aprobados = new Map<string, string>();
  const informe: ResultadoDeVerificacion[] = [];
  if (candidatos.length === 0 || cupo <= 0) return { aprobados, informe };

  const ids = candidatos.slice(0, 40).map((c) => c.leadId);
  const { data: leads, error } = await admin.from("leads").select("id, email, phone, extra, campaigns(name)").eq("organization_id", org).in("id", ids);
  if (error) throw new Error(`No se pudieron leer los prospectos a verificar: ${error.message}`);
  const porId = new Map((leads ?? []).map((l) => [l.id as string, l]));

  let nuevas = 0;
  for (const candidato of candidatos) {
    if (aprobados.size >= cupo) break;
    const lead = porId.get(candidato.leadId);
    if (!lead) continue;
    const extra = ((lead.extra as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const guardada = extra.verificacion_whatsapp as Partial<Verificacion> | undefined;

    if (verificacionVigente(guardada, ahora)) {
      if (guardada.estado === "aprobado") aprobados.set(candidato.leadId, guardada.celular_corregido ?? candidato.celular);
      continue;
    }
    if (nuevas >= VERIFICACIONES_POR_CORRIDA) continue;
    nuevas += 1;
    if (nuevas > 1 && !hayGooglePlaces()) await esperar(PAUSA_ENTRE_BUSQUEDAS_MS);

    const campana = (Array.isArray(lead.campaigns) ? lead.campaigns[0] : lead.campaigns) as { name?: string } | null;
    let resultado: Verificacion;
    try {
      resultado = await verificarProspecto(
        { leadId: candidato.leadId, empresa: candidato.empresa, email: (lead.email as string | null) ?? null, celular: (lead.phone as string | null) ?? candidato.celular, campana: campana?.name ?? null },
        ahora,
      );
    } catch (errorDeBusqueda) {
      informe.push({ empresa: candidato.empresa, estado: "pendiente", motivo: `La búsqueda falló (${errorDeBusqueda instanceof Error ? errorDeBusqueda.message : "sin detalle"}); se reintenta en la próxima corrida.`, nueva: true });
      continue;
    }

    informe.push({ empresa: candidato.empresa, estado: resultado.estado, motivo: resultado.motivo, nueva: true });
    if (!ensayo) {
      const cambios: Record<string, unknown> = { extra: { ...extra, verificacion_whatsapp: resultado } };
      if (resultado.celular_corregido) {
        cambios.phone = `+${resultado.celular_corregido}`;
        (cambios.extra as Record<string, unknown>).telefono_anterior = lead.phone ?? null;
        (cambios.extra as Record<string, unknown>).telefono_nota = `Atlas lo corrigió el ${ahora.toISOString().slice(0, 10)}: el anterior era un fijo mal convertido; este es el celular que el negocio publica.`;
      }
      const { error: errorAlGuardar } = await admin.from("leads").update(cambios).eq("id", candidato.leadId).eq("organization_id", org);
      if (errorAlGuardar) console.error("[verificacion] no se pudo guardar", candidato.leadId, errorAlGuardar.message);
    }
    if (resultado.estado === "aprobado") aprobados.set(candidato.leadId, resultado.celular_corregido ?? candidato.celular);
  }
  return { aprobados, informe };
}
