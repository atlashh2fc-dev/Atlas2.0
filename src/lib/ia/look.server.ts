import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  EsquemaAnalisis,
  INSTRUCCIONES_ANALISIS,
  MODELO_ANALISIS_POR_DEFECTO,
  MODELO_IMAGEN_POR_DEFECTO,
  MODELO_3D_POR_DEFECTO,
  entradaModelo3D,
  extraerImagen,
  instruccionDeImagen,
  mensajeDelBarbero,
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
    modelo3d: Boolean(process.env.FAL_KEY?.trim()),
  };
}

export const modeloDeAnalisis = () => process.env.ANTHROPIC_LOOK_MODEL?.trim() || MODELO_ANALISIS_POR_DEFECTO;
export const modeloDeImagen = () => process.env.FAL_IMAGE_MODEL?.trim() || MODELO_IMAGEN_POR_DEFECTO;
export const modeloDe3D = () => process.env.FAL_3D_MODEL?.trim() || MODELO_3D_POR_DEFECTO;

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

/**
 * Simula el corte sobre la foto del cliente desde un ángulo, con el editor de
 * imágenes de fal (Nano Banana Pro por defecto). Recibe enlaces firmados de las
 * fotos y devuelve la imagen generada.
 */
export async function simularVista({
  fotos,
  propuesta,
  vista,
}: {
  fotos: string[];
  propuesta: { descripcion_visual: string; mapa: MapaCorte; barba: string | null };
  vista: VistaLook;
}): Promise<{ data: Buffer; mime: string; modelo: string }> {
  const clave = claveFal();
  const modelo = modeloDeImagen();
  let respuesta: Response;
  try {
    respuesta = await fetch(`https://fal.run/${modelo}`, {
      method: "POST",
      headers: { Authorization: `Key ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: instruccionDeImagen(propuesta, vista, fotos.length > 1),
        image_urls: fotos,
        num_images: 1,
        aspect_ratio: "4:5",
        resolution: "1K",
        output_format: "jpeg",
      }),
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
  if (!imagen) throw new ErrorDeIA("La simulación no devolvió imagen. Prueba otra vez.", "sin_imagen");
  if (imagen.url) {
    const archivo = await fetch(imagen.url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!archivo?.ok) throw new ErrorDeIA("No se pudo descargar la simulación.", "proveedor");
    return { data: Buffer.from(await archivo.arrayBuffer()), mime: archivo.headers.get("content-type") ?? imagen.mime, modelo };
  }
  return { data: Buffer.from(imagen.data ?? "", "base64"), mime: imagen.mime, modelo };
}

export type SolicitudModelo3D = { request_id: string; status_url: string; response_url: string; modelo: string };

function claveFal(): string {
  const clave = process.env.FAL_KEY?.trim();
  if (!clave) throw new ErrorDeIA("Falta configurar el 3D del look.", "sin_clave");
  return clave;
}

/**
 * Pide el 3D del cliente con su look a la cola de fal (Rodin por defecto), a
 * partir de las vistas simuladas. Devuelve la solicitud para consultarla.
 */
export async function pedirModelo3D(imagenes: string[], descripcion: string): Promise<SolicitudModelo3D> {
  const clave = claveFal();
  const modelo = modeloDe3D();
  let respuesta: Response;
  try {
    respuesta = await fetch(`https://queue.fal.run/${modelo}`, {
      method: "POST",
      headers: { Authorization: `Key ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify(entradaModelo3D(modelo, imagenes, descripcion)),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ErrorDeIA("El servicio 3D no respondió. Prueba otra vez.", "proveedor");
  }
  const datos = (await respuesta.json().catch(() => null)) as Partial<SolicitudModelo3D> | null;
  if (!respuesta.ok || !datos?.request_id || !datos.status_url || !datos.response_url) {
    throw new ErrorDeIA("El servicio 3D rechazó el pedido. Prueba otra vez.", "proveedor");
  }
  return { request_id: datos.request_id, status_url: datos.status_url, response_url: datos.response_url, modelo };
}

export type EstadoModelo3D = { estado: "generando"; posicion: number | null } | { estado: "listo"; glb: Buffer } | { estado: "fallido"; motivo: string };

export async function consultarModelo3D(solicitud: SolicitudModelo3D): Promise<EstadoModelo3D> {
  const clave = claveFal();
  const cabeceras = { Authorization: `Key ${clave}` };
  const estado = await fetch(solicitud.status_url, { headers: cabeceras, signal: AbortSignal.timeout(15_000) })
    .then((respuesta) => respuesta.json() as Promise<{ status?: string; queue_position?: number; error?: string }>)
    .catch(() => null);
  if (!estado) return { estado: "generando", posicion: null };
  if (estado.error) return { estado: "fallido", motivo: "El 3D no se pudo generar con estas vistas." };
  if (estado.status !== "COMPLETED") return { estado: "generando", posicion: estado.queue_position ?? null };

  const resultado = await fetch(solicitud.response_url, { headers: cabeceras, signal: AbortSignal.timeout(20_000) })
    .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<{ model_mesh?: { url?: string }; model_glb?: { url?: string } }>) : null))
    .catch(() => null);
  // Rodin devuelve model_mesh; TRELLIS y Hunyuan, model_glb.
  const url = resultado?.model_mesh?.url ?? resultado?.model_glb?.url;
  if (!url) return { estado: "fallido", motivo: "El servicio 3D terminó sin modelo." };
  const archivo = await fetch(url, { signal: AbortSignal.timeout(40_000) }).catch(() => null);
  if (!archivo?.ok) return { estado: "generando", posicion: null };
  return { estado: "listo", glb: Buffer.from(await archivo.arrayBuffer()) };
}
