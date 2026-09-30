import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  EsquemaAnalisis,
  INSTRUCCIONES_ANALISIS,
  MODELO_ANALISIS_POR_DEFECTO,
  MODELO_IMAGEN_POR_DEFECTO,
  extraerImagen,
  instruccionDeImagen,
  mensajeDelBarbero,
  type ReferenciasDeImagen,
  type RespuestaAnalisis,
} from "@/lib/look-ia";
import type { MapaCorte, VistaLook } from "@/lib/look";

/*
 * Las llamadas a los proveedores de IA del Estudio de Look. Solo servidor.
 *
 * Análisis: Claude mira la foto y devuelve un JSON validado contra el esquema.
 * Simulación: Gemini edita la foto para mostrar el corte desde cada ángulo.
 * Sin la clave de cada proveedor, esa parte del Estudio se ofrece sin IA.
 */

export type FotoParaIA = { data: string; mime: string };

export class ErrorDeIA extends Error {
  constructor(
    message: string,
    readonly codigo: "sin_clave" | "rechazo" | "proveedor" | "sin_imagen" | "respuesta_invalida",
  ) {
    super(message);
  }
}

export function iaDisponible() {
  return {
    analisis: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    simulacion: Boolean(process.env.FAL_KEY?.trim()),
  };
}

export const modeloDeAnalisis = () => process.env.ANTHROPIC_LOOK_MODEL?.trim() || MODELO_ANALISIS_POR_DEFECTO;
export const modeloDeImagen = () => process.env.FAL_IMAGE_MODEL?.trim() || MODELO_IMAGEN_POR_DEFECTO;

export async function analizarFotos({ frontal, perfil, pedido }: { frontal: FotoParaIA; perfil?: FotoParaIA | null; pedido?: string | null }): Promise<{ respuesta: RespuestaAnalisis; modelo: string; uso: Record<string, unknown> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ErrorDeIA("Falta configurar el análisis con IA.", "sin_clave");
  const client = new Anthropic({ apiKey, timeout: 110_000, maxRetries: 1 });
  const imagen = (foto: FotoParaIA) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: foto.mime as "image/jpeg" | "image/png" | "image/webp", data: foto.data },
  });
  const modelo = modeloDeAnalisis();

  let respuesta;
  try {
    respuesta = await client.beta.messages.parse({
      model: modelo,
      max_tokens: 16000,
      // Si el modelo declina por una política, la API reintenta con el respaldo que corresponda.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(EsquemaAnalisis) },
      system: INSTRUCCIONES_ANALISIS,
      messages: [
        {
          role: "user",
          content: [imagen(frontal), ...(perfil ? [imagen(perfil)] : []), { type: "text", text: mensajeDelBarbero(pedido, Boolean(perfil)) }],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new ErrorDeIA("El análisis está saturado. Prueba en un minuto.", "proveedor");
    if (error instanceof Anthropic.BadRequestError) throw new ErrorDeIA("El proveedor rechazó la foto. Prueba con otra.", "proveedor");
    if (error instanceof Anthropic.APIError) throw new ErrorDeIA("El análisis no respondió. Prueba otra vez.", "proveedor");
    throw error;
  }

  if (respuesta.stop_reason === "refusal") throw new ErrorDeIA("La IA no analizó esta foto. Prueba con otra o sigue sin IA.", "rechazo");
  if (!respuesta.parsed_output) throw new ErrorDeIA("La respuesta del análisis vino incompleta. Prueba otra vez.", "respuesta_invalida");
  return {
    respuesta: respuesta.parsed_output,
    modelo: respuesta.model,
    uso: { input_tokens: respuesta.usage.input_tokens, output_tokens: respuesta.usage.output_tokens },
  };
}

function claveFal(): string {
  const clave = process.env.FAL_KEY?.trim();
  if (!clave) throw new ErrorDeIA("Falta configurar la simulación de fotos.", "sin_clave");
  return clave;
}

/**
 * Edita la foto del cliente con el editor de fal (Nano Banana 2 por defecto).
 * Recibe enlaces firmados de las fotos y devuelve el enlace de la imagen
 * generada apenas fal la entrega: guardarla en el bucket se hace después,
 * para que el barbero la vea sin esperar la descarga.
 */
export async function editarFoto({ fotos, instruccion }: { fotos: string[]; instruccion: string }): Promise<{ url: string; mime: string; modelo: string }> {
  const clave = claveFal();
  const modelo = modeloDeImagen();
  let respuesta: Response;
  try {
    respuesta = await fetch(`https://fal.run/${modelo}`, {
      method: "POST",
      headers: { Authorization: `Key ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: instruccion, image_urls: fotos, num_images: 1, aspect_ratio: "4:5", resolution: "1K", output_format: "jpeg" }),
      signal: AbortSignal.timeout(85_000),
    });
  } catch {
    throw new ErrorDeIA("La simulación no respondió a tiempo. Prueba otra vez.", "proveedor");
  }
  const json = (await respuesta.json().catch(() => null)) as unknown;
  if (!respuesta.ok) {
    const bloqueo = JSON.stringify(json ?? "").match(/safety|content policy|nsfw|blocked/i);
    throw new ErrorDeIA(bloqueo ? "El servicio no quiso editar esta foto. Prueba con otra." : "La simulación falló. Prueba otra vez.", bloqueo ? "rechazo" : "proveedor");
  }
  const imagen = extraerImagen(json);
  if (!imagen?.url) throw new ErrorDeIA("La simulación no devolvió imagen. Prueba otra vez.", "sin_imagen");
  return { url: imagen.url, mime: imagen.mime, modelo };
}

export function instruccionDeVista(propuesta: { descripcion_visual: string; mapa: MapaCorte; barba: string | null }, vista: VistaLook, referencias: ReferenciasDeImagen) {
  return instruccionDeImagen(propuesta, vista, referencias);
}

/** Descarga una imagen generada para guardarla en el bucket. */
export async function descargarImagen(url: string): Promise<{ data: Buffer; mime: string }> {
  const archivo = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!archivo.ok) throw new Error("No se pudo descargar la imagen generada.");
  return { data: Buffer.from(await archivo.arrayBuffer()), mime: archivo.headers.get("content-type") ?? "image/jpeg" };
}
