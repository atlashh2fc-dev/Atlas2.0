import { z } from "zod";

import { instanteEnChile } from "./citas.ts";
import {
  CANALES_MARKETING,
  ESTADOS_MARKETING,
  FORMATOS_MARKETING,
  ORIGENES_MARKETING,
  PRODUCTOS_MARKETING,
  type CanalMarketing,
  type ProductoMarketing,
} from "./marketing.ts";

/**
 * La puerta de entrada del calendario de Marketing: lo que envían los
 * alimentadores (Claude, Atlas Lead, Meta) a /api/marketing/items.
 *
 * Vive aparte del catálogo para que el calendario, que es de cliente, no
 * cargue zod. Tolerante con lo que entra (mayúsculas, tildes, alias como
 * "IG" o "pulso", fechas sin zona en hora de Chile) y estricto con lo que se
 * guarda: solo valores del catálogo.
 */

const FECHA_HORA_LOCAL = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;
const CON_ZONA = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Instante de una fecha que llega como texto. Con zona ("…Z", "-03:00") se
 * respeta; sin zona ("2026-10-05 13:00" o solo "2026-10-05") es hora de
 * Chile, que es como la escribe quien planifica la semana.
 */
export function instanteDesdeTexto(valor: string): Date | null {
  const texto = valor.trim();
  if (CON_ZONA.test(texto)) {
    const instante = new Date(texto);
    return Number.isNaN(instante.getTime()) ? null : instante;
  }
  const partes = FECHA_HORA_LOCAL.exec(texto);
  if (!partes) return null;
  const [, fecha, hh = "00", mm = "00"] = partes;
  if (Number(hh) > 23 || Number(mm) > 59 || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) return null;
  try {
    return instanteEnChile(fecha, `${hh}:${mm}`);
  } catch {
    return null;
  }
}

/** Minúsculas, sin tildes y con guion bajo: "Facebook Grupo" → "facebook_grupo". */
function clave(valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const ALIAS_CANAL: Record<string, CanalMarketing> = {
  ig: "instagram",
  fb: "facebook",
  grupo_facebook: "facebook_grupo",
  grupo_fb: "facebook_grupo",
  correo: "email",
  mail: "email",
  ads: "meta_ads",
  wa: "whatsapp",
};
const ALIAS_PRODUCTO: Record<string, ProductoMarketing> = { crm_barber: "crm_barberia", pulso: "atlas_pulso", crm: "atlas_crm" };

const enumTolerante = <T extends string>(lista: readonly T[], alias: Record<string, T> = {}) =>
  z.preprocess((valor) => {
    const normal = clave(valor);
    return typeof normal === "string" ? alias[normal] ?? normal : normal;
  }, z.enum(lista as unknown as [T, ...T[]]));

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((valor) => {
      const limpio = valor?.trim() ?? "";
      return limpio === "" ? null : limpio;
    });

const urlOpcional = textoOpcional(2000).refine((valor) => valor === null || /^https?:\/\/\S+$/i.test(valor), {
  message: "Tiene que ser un enlace http(s)",
});

const instante = (requerido: boolean) =>
  z.string().nullish().transform((valor, ctx) => {
    if (valor === null || valor === undefined || valor.trim() === "") {
      if (requerido) ctx.addIssue({ code: "custom", message: "Falta la fecha" });
      return null;
    }
    const fecha = instanteDesdeTexto(valor);
    if (!fecha) {
      ctx.addIssue({ code: "custom", message: "Fecha no reconocida; usa ISO 8601 o «AAAA-MM-DD HH:MM» (hora de Chile)" });
      return null;
    }
    return fecha.toISOString();
  });

/**
 * Cifras (alcance, leads…) y, como única excepción de texto, `poster_url`:
 * la portada del video que el calendario muestra antes de reproducirlo.
 */
const metricas = z
  .record(z.string().min(1).max(40), z.union([z.coerce.number().finite().nonnegative(), z.string().trim().max(2000)]))
  .nullish()
  .transform((valor) => valor ?? {})
  .refine((valor) => Object.keys(valor).length <= 30, { message: "Demasiadas métricas" })
  .superRefine((valor, ctx) => {
    for (const [clave, dato] of Object.entries(valor)) {
      if (typeof dato !== "string") continue;
      if (clave !== "poster_url") ctx.addIssue({ code: "custom", path: [clave], message: "Tiene que ser un número" });
      else if (!/^https?:\/\/\S+$/i.test(dato)) ctx.addIssue({ code: "custom", path: [clave], message: "Tiene que ser un enlace http(s)" });
    }
  });

/** Una pieza tal como la envía un alimentador. */
export const piezaEntranteSchema = z
  .object({
    external_id: z.string().trim().min(1, "Falta external_id").max(200),
    source: enumTolerante(ORIGENES_MARKETING),
    channel: enumTolerante(CANALES_MARKETING, ALIAS_CANAL),
    format: enumTolerante(FORMATOS_MARKETING),
    status: enumTolerante(ESTADOS_MARKETING).default("borrador"),
    title: z.string().trim().min(1, "Falta el título").max(300),
    body: textoOpcional(20000),
    campaign: textoOpcional(120),
    target: textoOpcional(300),
    product: z.preprocess((valor) => (valor === "" ? null : valor), enumTolerante(PRODUCTOS_MARKETING, ALIAS_PRODUCTO).nullish()),
    agent: textoOpcional(120),
    asset_url: urlOpcional,
    external_url: urlOpcional,
    scheduled_at: instante(true),
    ends_at: instante(false),
    published_at: instante(false),
    metrics: metricas,
  })
  .superRefine((pieza, ctx) => {
    if (pieza.scheduled_at && pieza.ends_at && pieza.ends_at < pieza.scheduled_at) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "Termina antes de empezar" });
    }
  });

export type PiezaEntrante = z.output<typeof piezaEntranteSchema>;

export const MAX_PIEZAS_POR_ENVIO = 200;

/** El cuerpo del POST: `{ items: [...] }` o una pieza suelta. */
export const envioDeMarketingSchema = z.preprocess(
  (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) && !("items" in valor) ? { items: [valor] } : valor),
  z.object({
    items: z
      .array(z.unknown())
      .min(1, "No vienen piezas")
      .max(MAX_PIEZAS_POR_ENVIO, `Máximo ${MAX_PIEZAS_POR_ENVIO} piezas por envío`),
  }),
);

export type ErrorDePieza = { indice: number; external_id: string | null; errores: string[] };

/**
 * Valida cada pieza por separado: una pieza mala no tiene que esconder cuáles
 * son las otras malas. Devuelve las filas listas para el upsert (todas las
 * columnas, con null donde no vino nada: cada envío reemplaza la pieza
 * completa y el resultado no depende de qué otra pieza venía en el lote).
 */
export function validarPiezas(items: unknown[], organizationId: string): { filas: Record<string, unknown>[]; errores: ErrorDePieza[] } {
  const filas: Record<string, unknown>[] = [];
  const errores: ErrorDePieza[] = [];
  const vistos = new Set<string>();

  items.forEach((item, indice) => {
    const crudo = item && typeof item === "object" ? (item as { external_id?: unknown }).external_id : undefined;
    const externalId = typeof crudo === "string" && crudo.trim() !== "" ? crudo.trim() : null;
    const resultado = piezaEntranteSchema.safeParse(item);
    if (!resultado.success) {
      errores.push({
        indice,
        external_id: externalId,
        errores: resultado.error.issues.map((issue) => `${issue.path.join(".") || "pieza"}: ${issue.message}`),
      });
      return;
    }
    const pieza = resultado.data;
    // Dos veces la misma pieza en un lote haría fallar el upsert entero.
    const llave = `${pieza.source}\u0000${pieza.external_id}`;
    if (vistos.has(llave)) {
      errores.push({ indice, external_id: pieza.external_id, errores: ["external_id: repetido en este envío"] });
      return;
    }
    vistos.add(llave);
    filas.push({
      organization_id: organizationId,
      external_id: pieza.external_id,
      source: pieza.source,
      channel: pieza.channel,
      format: pieza.format,
      status: pieza.status,
      title: pieza.title,
      body: pieza.body,
      campaign: pieza.campaign,
      target: pieza.target,
      product: pieza.product ?? null,
      agent: pieza.agent,
      asset_url: pieza.asset_url,
      external_url: pieza.external_url,
      scheduled_at: pieza.scheduled_at,
      ends_at: pieza.ends_at,
      published_at: pieza.published_at,
      metrics: pieza.metrics,
    });
  });

  return { filas, errores };
}
