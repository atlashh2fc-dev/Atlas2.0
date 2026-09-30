import { z } from "zod";

import {
  CATALOGO_CORTES,
  DENSIDADES,
  ENTRADAS,
  FORMAS_ROSTRO,
  INFO_VISTA,
  MAPA_NEUTRO,
  TECNICAS,
  TIPOS_PELO,
  ZONAS,
  mapaParaImagen,
  normalizarMapa,
  type AnalisisLook,
  type MapaCorte,
  type VistaLook,
} from "./look.ts";

/**
 * Lo que la IA del Estudio de Look recibe y devuelve. Puro: sin red, para
 * poder probarlo. Las llamadas viven en `src/lib/ia/look.server.ts`.
 */

export const MODELO_ANALISIS_POR_DEFECTO = "claude-opus-5-5";
export const MODELO_IMAGEN_POR_DEFECTO = "fal-ai/nano-banana-2/edit";

/** Topes diarios por empresa, para que un error o un abuso no se coma la cuenta. */
export const TOPE_ANALISIS_DIARIO = 60;
export const TOPE_IMAGENES_DIARIO = 240;
const LargoDeZona = z.object({ mm: z.number(), tecnica: z.enum(TECNICAS) });
const Mapa = z.object(Object.fromEntries(ZONAS.map((zona) => [zona, LargoDeZona])) as Record<(typeof ZONAS)[number], typeof LargoDeZona>);

export const EsquemaAnalisis = z.object({
  foto_util: z.boolean(),
  problema_foto: z.string(),
  rostro: z.object({
    forma: z.enum(FORMAS_ROSTRO),
    confianza: z.enum(["alta", "media", "baja"]),
    frente: z.string(),
    mandibula: z.string(),
    pomulos: z.string(),
    notas: z.string(),
  }),
  pelo: z.object({
    tipo: z.enum(TIPOS_PELO),
    grosor: z.enum(["fino", "medio", "grueso"]),
    densidad: z.enum(DENSIDADES),
    color: z.string(),
    largo_actual_mm: z.number(),
    entradas: z.enum(ENTRADAS),
    remolinos: z.string(),
    linea_nacimiento: z.string(),
  }),
  barba: z.object({
    tiene: z.boolean(),
    densidad: z.enum(["nula", "baja", "media", "alta"]),
    estilo_actual: z.string(),
  }),
  estilo_actual: z.string(),
  propuestas: z.array(
    z.object({
      nombre: z.string(),
      corte_base: z.string(),
      por_que: z.string(),
      que_decirle: z.string(),
      mantencion_semanas: z.number(),
      dificultad: z.enum(["baja", "media", "alta"]),
      barba: z.string(),
      descripcion_visual: z.string(),
      mapa: Mapa,
    }),
  ),
  evitar: z.array(z.object({ nombre: z.string(), por_que: z.string() })),
  notas_para_barbero: z.string(),
});

export type RespuestaAnalisis = z.infer<typeof EsquemaAnalisis>;

export const INSTRUCCIONES_ANALISIS = `Eres un barbero senior y asesor de imagen masculina en una barbería de Chile. Trabajas dentro de Atlas Barber, en el sillón, junto al barbero y su cliente.

Recibes una foto frontal del cliente (a veces también de perfil) y, si lo dijo, lo que pide. Tu trabajo:
1. Leer lo que se ve: forma del rostro, frente, mandíbula, pómulos; tipo, grosor, densidad y color del pelo; entradas, remolinos y línea de nacimiento; barba; y el estilo actual.
2. Proponer entre 3 y 4 cortes que le queden bien a ESTA persona, ordenados del más recomendado al menos. Considera sus facciones, su tipo de pelo, las entradas, lo que pidió y cuánta mantención implica. Al menos una propuesta debe ser conservadora y fácil de mantener.
3. Para cada propuesta, un mapa de corte completo: por cada zona, los milímetros que quedan y la técnica. Usa las guardas reales de máquina (al cero 0,5 mm; N.º 0,5 1,5 mm; N.º 1 3 mm; N.º 1,5 4,5 mm; N.º 2 6 mm; N.º 3 10 mm; N.º 4 13 mm; N.º 5 16 mm; N.º 6 19 mm; N.º 7 22 mm; N.º 8 25 mm) y tijera sobre 25 mm. Barba en 0 mm si va afeitada. Un degradado baja de largo hacia abajo: lateral_bajo y nuca_baja más cortos que lateral_alto y nuca_alta.
4. descripcion_visual: una frase en INGLÉS que describa solo el pelo y la barba resultantes, para un modelo que edita la foto (largo en cm arriba, tipo de degradado y su altura, peinado, textura, barba).
5. que_decirle: una frase corta, en español de Chile y de tú, para mostrarle al cliente por qué le conviene.
6. evitar: cortes que NO le recomiendas y por qué, en una línea cada uno.
7. notas_para_barbero: lo técnico que el barbero debe cuidar (remolinos, dirección de crecimiento, densidad, línea).

corte_base: el id del catálogo que más se parece, o "otro". Catálogo: ${CATALOGO_CORTES.map((corte) => `${corte.id} (${corte.nombre})`).join("; ")}.

Reglas:
- Escribe en español de Chile, claro y breve. Nada de jerga de marketing.
- Describe solo rasgos visibles del rostro y del pelo. No infieras ni menciones etnia, nacionalidad, religión, salud, orientación, edad exacta ni ningún rasgo sensible, y no intentes identificar a la persona.
- Si la foto no sirve (no hay una cara, hay varias, está muy oscura, borrosa o tapada), pon foto_util en false, explica en problema_foto qué hay que corregir y deja las propuestas vacías.
- La confianza del rostro es "baja" si el ángulo o el pelo tapan la forma.`;

export function mensajeDelBarbero(pedido: string | null | undefined, conPerfil: boolean): string {
  const partes = [
    conPerfil ? "La primera foto es de frente y la segunda de perfil." : "La foto es de frente.",
    pedido?.trim() ? `Lo que pide el cliente: "${pedido.trim().slice(0, 500)}".` : "El cliente no dijo nada en particular: propón lo que mejor le quede.",
    "Devuelve el análisis y las propuestas.",
  ];
  return partes.join(" ");
}

/** De lo que devolvió la IA a lo que se guarda: mapas completos y en rango, sin textos vacíos. */
export function normalizarRespuesta(respuesta: RespuestaAnalisis): { analisis: AnalisisLook; propuestas: PropuestaNueva[] } {
  const ids = new Set(CATALOGO_CORTES.map((corte) => corte.id));
  const analisis: AnalisisLook = {
    rostro: respuesta.rostro,
    pelo: { ...respuesta.pelo, largo_actual_mm: Math.max(0, Math.round(respuesta.pelo.largo_actual_mm)) },
    barba: respuesta.barba,
    estilo_actual: respuesta.estilo_actual,
    foto_util: respuesta.foto_util,
    problema_foto: respuesta.problema_foto,
    evitar: respuesta.evitar.slice(0, 5),
    notas_para_barbero: respuesta.notas_para_barbero,
  };
  const propuestas = respuesta.foto_util
    ? respuesta.propuestas.slice(0, 4).map((propuesta, orden) => ({
        orden,
        nombre: propuesta.nombre.trim().slice(0, 120) || `Propuesta ${orden + 1}`,
        corte_base: ids.has(propuesta.corte_base) ? propuesta.corte_base : null,
        por_que: propuesta.por_que.trim().slice(0, 800),
        que_decirle: propuesta.que_decirle.trim().slice(0, 300) || null,
        mantencion_semanas: Math.min(12, Math.max(1, Math.round(propuesta.mantencion_semanas || 4))),
        dificultad: propuesta.dificultad,
        barba: propuesta.barba.trim().slice(0, 160) || null,
        descripcion_visual: propuesta.descripcion_visual.trim().slice(0, 600),
        mapa: normalizarMapa(propuesta.mapa, MAPA_NEUTRO),
        origen: "ia" as const,
      }))
    : [];
  return { analisis, propuestas };
}

export type PropuestaNueva = {
  orden: number;
  nombre: string;
  corte_base: string | null;
  por_que: string;
  que_decirle: string | null;
  mantencion_semanas: number;
  dificultad: "baja" | "media" | "alta";
  barba: string | null;
  descripcion_visual: string;
  mapa: MapaCorte;
  origen: "ia" | "reglas" | "barbero";
};

/**
 * La instrucción para editar la foto: misma persona, mismo todo, solo cambia
 * el pelo y la barba, desde el ángulo pedido.
 */
export function instruccionDeImagen(propuesta: { descripcion_visual: string; mapa: MapaCorte; barba: string | null }, vista: VistaLook, conPerfil: boolean): string {
  const angulo = INFO_VISTA[vista].camara;
  const referencias = conPerfil
    ? "The first image is the client from the front and the second from the side; use both to keep the identity."
    : "The image is the client from the front.";
  return [
    `${referencias} Create a photorealistic barbershop portrait of THE SAME PERSON after a new haircut.`,
    "Keep the exact same identity: same face, facial structure, skin tone and texture, eyes, nose, mouth, ears, expression and apparent age. Do not beautify, slim or retouch the face. Do not change clothing into anything flashy.",
    `Change ONLY the hair and beard to: ${propuesta.descripcion_visual}.`,
    `Exact lengths by zone for the barber: ${mapaParaImagen(propuesta.mapa)}.`,
    `Camera: ${angulo}. Soft, even studio light, neutral warm-grey background, sharp focus, natural colors, 85mm lens look.`,
    "No text, no logos, no watermark, no hats, no accessories, no extra people.",
  ].join(" ");
}

/**
 * El "antes": la misma persona con el mismo pelo, rehecha como retrato de
 * estudio con el encuadre, la luz y el fondo de las simulaciones.
 */
export function instruccionDeRetrato(conPerfil: boolean): string {
  return [
    conPerfil ? "The first image is the client from the front and the second from the side; use both to keep the identity." : "The image is the client from the front.",
    "Create a photorealistic barbershop portrait of THE SAME PERSON exactly as they look now.",
    "Keep the exact same identity: face, facial structure, skin tone and texture, eyes, nose, mouth, ears, expression and apparent age.",
    "Keep the hair and beard EXACTLY as they are now: same length, volume, color, shape, parting and hairline. Do not style, trim or improve them.",
    `Camera: ${INFO_VISTA.frontal.camara}. Soft, even studio light, neutral warm-grey background, sharp focus, natural colors, 85mm lens look.`,
    "No text, no logos, no watermark, no hats, no accessories, no extra people.",
  ].join(" ");
}

type Json = Record<string, unknown>;

/** Busca la imagen en la respuesta del editor, tolerando las formas conocidas (fal y Gemini). */
export function extraerImagen(respuesta: unknown): { data?: string; url?: string; mime: string } | null {
  if (!respuesta || typeof respuesta !== "object") return null;
  const raiz = respuesta as Json;
  if (Array.isArray(raiz.images)) {
    const primera = (raiz.images as Json[]).find((imagen) => typeof imagen?.url === "string");
    if (primera) return { url: primera.url as string, mime: String(primera.content_type ?? "image/jpeg") };
  }
  const directa = raiz.output_image as Json | undefined;
  if (directa && typeof directa.data === "string") return { data: directa.data, mime: String(directa.mime_type ?? "image/jpeg") };
  for (const lista of [raiz.outputs, raiz.output]) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista as Json[]) {
      if (item && (item.type === "image" || typeof item.mime_type === "string") && typeof item.data === "string") {
        return { data: item.data, mime: String(item.mime_type ?? "image/jpeg") };
      }
    }
  }
  const candidatos = raiz.candidates;
  if (Array.isArray(candidatos)) {
    for (const candidato of candidatos as Json[]) {
      const partes = ((candidato.content as Json | undefined)?.parts ?? []) as Json[];
      for (const parte of partes) {
        const datos = (parte.inlineData ?? parte.inline_data) as Json | undefined;
        if (datos && typeof datos.data === "string") return { data: datos.data, mime: String(datos.mimeType ?? datos.mime_type ?? "image/png") };
      }
    }
  }
  return null;
}
