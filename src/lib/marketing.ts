import type { BadgeTone } from "@/components/ui";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile, sumarDias } from "./citas.ts";

/**
 * Marketing · calendario de lo que la empresa publica.
 *
 * Catálogo (canales, formatos, productos, estados) y las cuentas del
 * calendario. Es puro a propósito: lo usan la página, el calendario de cliente
 * y las pruebas, sin arrastrar el servidor ni zod. La validación de lo que
 * envían los alimentadores vive en `marketing-ingreso.ts`.
 *
 * Las horas son de Chile, como en la agenda de la clínica: una pieza
 * "programada a las 13:00" es a las 13:00 en Santiago, cambie o no la hora.
 */

export const ZONA_MARKETING = ZONA_CLINICA;

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const CANALES_MARKETING = [
  "instagram",
  "facebook",
  "facebook_grupo",
  "email",
  "meta_ads",
  "whatsapp",
  "web",
  "tiktok",
  "linkedin",
  "otro",
] as const;
export type CanalMarketing = (typeof CANALES_MARKETING)[number];

/**
 * `tono` es una variable del tema (--tone-*): cambia sola en claro y oscuro.
 * Ámbar queda fuera a propósito, para que ningún canal se lea como alerta.
 */
export const CANAL_INFO: Record<CanalMarketing, { label: string; corto: string; tono: string }> = {
  instagram: { label: "Instagram", corto: "IG", tono: "--tone-pink" },
  facebook: { label: "Facebook", corto: "FB", tono: "--tone-blue" },
  facebook_grupo: { label: "Grupo de Facebook", corto: "Grupo FB", tono: "--tone-indigo" },
  email: { label: "Correo", corto: "Correo", tono: "--tone-teal" },
  meta_ads: { label: "Anuncios de Meta", corto: "Anuncio", tono: "--tone-orange" },
  whatsapp: { label: "WhatsApp", corto: "WA", tono: "--tone-green" },
  web: { label: "Sitio web", corto: "Web", tono: "--tone-cyan" },
  tiktok: { label: "TikTok", corto: "TikTok", tono: "--tone-rose" },
  linkedin: { label: "LinkedIn", corto: "LinkedIn", tono: "--tone-violet" },
  otro: { label: "Otro canal", corto: "Otro", tono: "--tone-slate" },
};

export const FORMATOS_MARKETING = ["reel", "post", "historia", "carrusel", "correo", "anuncio", "video", "imagen"] as const;
export type FormatoMarketing = (typeof FORMATOS_MARKETING)[number];

export const ETIQUETA_FORMATO: Record<FormatoMarketing, string> = {
  reel: "Reel",
  post: "Publicación",
  historia: "Historia",
  carrusel: "Carrusel",
  correo: "Correo",
  anuncio: "Anuncio",
  video: "Video",
  imagen: "Imagen",
};

export const PRODUCTOS_MARKETING = ["atlas_crm", "crm_dental", "crm_vet", "crm_barberia", "crm_center", "atlas_pulso"] as const;
export type ProductoMarketing = (typeof PRODUCTOS_MARKETING)[number];

export const ETIQUETA_PRODUCTO: Record<ProductoMarketing, string> = {
  atlas_crm: "Atlas CRM",
  crm_dental: "Atlas CRM Dental",
  crm_vet: "Atlas CRM Vet",
  crm_barberia: "Atlas CRM Barbería",
  crm_center: "Atlas CRM Center",
  atlas_pulso: "Atlas Pulso",
};

export const ESTADOS_MARKETING = ["idea", "borrador", "programado", "publicado", "pausado", "fallido"] as const;
export type EstadoMarketing = (typeof ESTADOS_MARKETING)[number];

export const ETIQUETA_ESTADO_MARKETING: Record<EstadoMarketing, { label: string; tone: BadgeTone }> = {
  idea: { label: "Idea", tone: "neutral" },
  borrador: { label: "Borrador", tone: "neutral" },
  programado: { label: "Programado", tone: "info" },
  publicado: { label: "Publicado", tone: "success" },
  pausado: { label: "Pausado", tone: "warning" },
  fallido: { label: "Falló", tone: "danger" },
};

export const ORIGENES_MARKETING = ["claude", "atlas_lead", "meta", "manual"] as const;
export type OrigenMarketing = (typeof ORIGENES_MARKETING)[number];

export const ETIQUETA_ORIGEN: Record<OrigenMarketing, string> = {
  claude: "Claude",
  atlas_lead: "Atlas Lead",
  meta: "Meta",
  manual: "Carga manual",
};

/** Métricas que se muestran con nombre; cualquier otra llega y se guarda igual. */
export const METRICAS_MARKETING = ["reach", "reactions", "comments", "shares", "saves", "leads"] as const;
export type MetricaMarketing = (typeof METRICAS_MARKETING)[number];

export const ETIQUETA_METRICA: Record<MetricaMarketing, string> = {
  reach: "Alcance",
  reactions: "Reacciones",
  comments: "Comentarios",
  shares: "Compartidos",
  saves: "Guardados",
  leads: "Leads",
};

export type PiezaMarketing = {
  id: string;
  campaign: string | null;
  channel: CanalMarketing;
  format: FormatoMarketing;
  title: string;
  body: string | null;
  target: string | null;
  product: ProductoMarketing | null;
  agent: string | null;
  asset_url: string | null;
  external_url: string | null;
  status: EstadoMarketing;
  scheduled_at: string;
  ends_at: string | null;
  published_at: string | null;
  metrics: Record<string, number>;
  source: OrigenMarketing;
  updated_at: string;
};

export const COLUMNAS_PIEZA =
  "id, campaign, channel, format, title, body, target, product, agent, asset_url, external_url, status, scheduled_at, ends_at, published_at, metrics, source, updated_at";

export const enLista = <T extends string>(lista: readonly T[], valor: unknown): valor is T =>
  typeof valor === "string" && (lista as readonly string[]).includes(valor);

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export type VistaCalendario = "semana" | "mes";

export type RangoCalendario = {
  vista: VistaCalendario;
  /** Fecha pedida (ancla de la navegación). */
  fecha: string;
  /** Primer día visible, inclusive. */
  desde: string;
  /** Día siguiente al último visible. */
  hasta: string;
  dias: string[];
  anterior: string;
  siguiente: string;
  /** "Semana del 5 al 11 de octubre" / "Octubre de 2026". */
  titulo: string;
  /** Mes al que pertenece la vista mensual ("2026-10"); los días de otros meses van atenuados. */
  mes: string;
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaCalendario(valor: unknown): valor is string {
  return typeof valor === "string" && FECHA_ISO.test(valor) && !Number.isNaN(Date.parse(`${valor}T12:00:00Z`));
}

/** 0 = lunes … 6 = domingo, para una fecha "2026-10-05". */
export function diaDeLaSemana(fecha: string): number {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return (new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() + 6) % 7;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function diaYMes(fecha: string): { dia: number; mes: string; anio: number } {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { dia, mes: MESES[mes - 1], anio };
}

function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1 + meses, 1)).toISOString().slice(0, 10);
}

export function rangoDelCalendario(vista: VistaCalendario, fecha: string): RangoCalendario {
  if (vista === "semana") {
    const desde = sumarDias(fecha, -diaDeLaSemana(fecha));
    const ultimo = sumarDias(desde, 6);
    const a = diaYMes(desde);
    const b = diaYMes(ultimo);
    const titulo =
      a.anio !== b.anio
        ? `Semana del ${a.dia} de ${a.mes} de ${a.anio} al ${b.dia} de ${b.mes} de ${b.anio}`
        : a.mes === b.mes
          ? `Semana del ${a.dia} al ${b.dia} de ${b.mes}`
          : `Semana del ${a.dia} de ${a.mes} al ${b.dia} de ${b.mes}`;
    return {
      vista,
      fecha,
      desde,
      hasta: sumarDias(desde, 7),
      dias: Array.from({ length: 7 }, (_, i) => sumarDias(desde, i)),
      anterior: sumarDias(fecha, -7),
      siguiente: sumarDias(fecha, 7),
      titulo,
      mes: fecha.slice(0, 7),
    };
  }

  const primero = `${fecha.slice(0, 7)}-01`;
  const ultimoDelMes = sumarDias(sumarMeses(primero, 1), -1);
  const desde = sumarDias(primero, -diaDeLaSemana(primero));
  const hasta = sumarDias(ultimoDelMes, 7 - diaDeLaSemana(ultimoDelMes));
  const dias: string[] = [];
  for (let dia = desde; dia < hasta; dia = sumarDias(dia, 1)) dias.push(dia);
  const { mes, anio } = diaYMes(primero);
  return {
    vista,
    fecha,
    desde,
    hasta,
    dias,
    anterior: sumarMeses(primero, -1),
    siguiente: sumarMeses(primero, 1),
    titulo: `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${anio}`,
    mes: primero.slice(0, 7),
  };
}

/** Instantes UTC del rango, para la consulta. */
export function limitesDelRango(rango: Pick<RangoCalendario, "desde" | "hasta">): { desde: string; hasta: string } {
  return { desde: instanteEnChile(rango.desde).toISOString(), hasta: instanteEnChile(rango.hasta).toISOString() };
}

/**
 * Días visibles en que aparece la pieza. Una campaña de anuncios del 5 al 11
 * está en cada uno de esos días; una publicación, solo en el suyo.
 */
export function diasDeLaPieza(pieza: Pick<PiezaMarketing, "scheduled_at" | "ends_at">, dias: readonly string[]): string[] {
  const inicio = fechaEnChile(new Date(pieza.scheduled_at));
  const fin = pieza.ends_at ? fechaEnChile(new Date(pieza.ends_at)) : inicio;
  return dias.filter((dia) => dia >= inicio && dia <= fin);
}

export function agruparPorDia(piezas: readonly PiezaMarketing[], dias: readonly string[]): Map<string, PiezaMarketing[]> {
  const porDia = new Map<string, PiezaMarketing[]>(dias.map((dia) => [dia, []]));
  for (const pieza of piezas) {
    for (const dia of diasDeLaPieza(pieza, dias)) porDia.get(dia)?.push(pieza);
  }
  for (const lista of porDia.values()) lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.title.localeCompare(b.title, "es"));
  return porDia;
}

export type ResumenMarketing = {
  total: number;
  porEstado: Partial<Record<EstadoMarketing, number>>;
  porCanal: Partial<Record<CanalMarketing, number>>;
  leads: number;
};

export function resumenDelRango(piezas: readonly Pick<PiezaMarketing, "status" | "channel" | "metrics">[]): ResumenMarketing {
  const resumen: ResumenMarketing = { total: piezas.length, porEstado: {}, porCanal: {}, leads: 0 };
  for (const pieza of piezas) {
    resumen.porEstado[pieza.status] = (resumen.porEstado[pieza.status] ?? 0) + 1;
    resumen.porCanal[pieza.channel] = (resumen.porCanal[pieza.channel] ?? 0) + 1;
    const leads = Number(pieza.metrics?.leads);
    if (Number.isFinite(leads) && leads > 0) resumen.leads += leads;
  }
  return resumen;
}

export type FiltrosMarketing = {
  canal?: CanalMarketing;
  estado?: EstadoMarketing;
  producto?: ProductoMarketing;
  campana?: string;
};

/** Lo que venga en la URL que no sea del catálogo se ignora, no rompe la página. */
export function filtrosDesdeParams(params: Record<string, string | string[] | undefined>): FiltrosMarketing {
  const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);
  const filtros: FiltrosMarketing = {};
  const canal = uno(params.canal);
  const estado = uno(params.estado);
  const producto = uno(params.producto);
  const campana = uno(params.campana)?.trim().slice(0, 120);
  if (enLista(CANALES_MARKETING, canal)) filtros.canal = canal;
  if (enLista(ESTADOS_MARKETING, estado)) filtros.estado = estado;
  if (enLista(PRODUCTOS_MARKETING, producto)) filtros.producto = producto;
  if (campana) filtros.campana = campana;
  return filtros;
}

/** Querystring del calendario conservando vista, fecha y filtros. */
export function enlaceDelCalendario(vista: VistaCalendario, fecha: string, filtros: FiltrosMarketing): string {
  const params = new URLSearchParams({ vista, fecha });
  if (filtros.canal) params.set("canal", filtros.canal);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.producto) params.set("producto", filtros.producto);
  if (filtros.campana) params.set("campana", filtros.campana);
  return `/dashboard/marketing?${params}`;
}

/** Piezas con imagen o video que se pueden mostrar en el panel. */
export function tipoDeArchivo(url: string | null): "imagen" | "video" | "otro" | null {
  if (!url) return null;
  const ruta = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|avif)$/.test(ruta)) return "imagen";
  if (/\.(mp4|webm|mov|m4v)$/.test(ruta)) return "video";
  return "otro";
}
