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
  /** Cifras, y a lo más `poster_url` (portada del video), que es texto. */
  metrics: Record<string, number | string>;
  source: OrigenMarketing;
  /** Identificador del alimentador: "plan-…" marca un espacio de plan de Claude. */
  external_id: string | null;
  updated_at: string;
};

export const COLUMNAS_PIEZA =
  "id, campaign, channel, format, title, body, target, product, agent, asset_url, external_url, status, scheduled_at, ends_at, published_at, metrics, source, external_id, updated_at";

export const enLista = <T extends string>(lista: readonly T[], valor: unknown): valor is T =>
  typeof valor === "string" && (lista as readonly string[]).includes(valor);

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

export const VISTAS_CALENDARIO = ["proximos", "semana", "mes"] as const;
export type VistaCalendario = (typeof VISTAS_CALENDARIO)[number];

export const ETIQUETA_VISTA: Record<VistaCalendario, string> = { proximos: "Próximos", semana: "Semana", mes: "Mes" };

/** Lo que abarca la vista «Próximos»: dos semanas desde hoy. */
export const DIAS_PROXIMOS = 14;

/** Sin vista en la URL (o con una que no existe) se abre «Próximos»: lo que viene, como agenda. */
export function vistaDesdeParam(valor: unknown): VistaCalendario {
  return enLista(VISTAS_CALENDARIO, valor) ? valor : "proximos";
}

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
  /** "Del 3 al 16 de octubre" / "Semana del 5 al 11 de octubre" / "Octubre de 2026". */
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

/** "5 al 11 de octubre", "28 de septiembre al 4 de octubre"; el año solo si cambia. */
function tramo(desde: string, ultimo: string): string {
  const a = diaYMes(desde);
  const b = diaYMes(ultimo);
  if (a.anio !== b.anio) return `${a.dia} de ${a.mes} de ${a.anio} al ${b.dia} de ${b.mes} de ${b.anio}`;
  return a.mes === b.mes ? `${a.dia} al ${b.dia} de ${b.mes}` : `${a.dia} de ${a.mes} al ${b.dia} de ${b.mes}`;
}

export function rangoDelCalendario(vista: VistaCalendario, fecha: string): RangoCalendario {
  if (vista === "proximos") {
    return {
      vista,
      fecha,
      desde: fecha,
      hasta: sumarDias(fecha, DIAS_PROXIMOS),
      dias: Array.from({ length: DIAS_PROXIMOS }, (_, i) => sumarDias(fecha, i)),
      anterior: sumarDias(fecha, -DIAS_PROXIMOS),
      siguiente: sumarDias(fecha, DIAS_PROXIMOS),
      titulo: `Del ${tramo(fecha, sumarDias(fecha, DIAS_PROXIMOS - 1))}`,
      mes: fecha.slice(0, 7),
    };
  }

  if (vista === "semana") {
    const desde = sumarDias(fecha, -diaDeLaSemana(fecha));
    return {
      vista,
      fecha,
      desde,
      hasta: sumarDias(desde, 7),
      dias: Array.from({ length: 7 }, (_, i) => sumarDias(desde, i)),
      anterior: sumarDias(fecha, -7),
      siguiente: sumarDias(fecha, 7),
      titulo: `Semana del ${tramo(desde, sumarDias(desde, 6))}`,
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

type Ubicable = Pick<PiezaMarketing, "scheduled_at" | "ends_at" | "title">;

export function agruparPorDia<T extends Ubicable>(piezas: readonly T[], dias: readonly string[]): Map<string, T[]> {
  const porDia = new Map<string, T[]>(dias.map((dia) => [dia, []]));
  for (const pieza of piezas) {
    for (const dia of diasDeLaPieza(pieza, dias)) porDia.get(dia)?.push(pieza);
  }
  for (const lista of porDia.values()) lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.title.localeCompare(b.title, "es"));
  return porDia;
}

/**
 * El día de la agenda «Próximos» en que va la pieza: una sola vez, el día en
 * que sale. Una campaña que ya venía corriendo va el primer día del rango;
 * repetir un anuncio de siete días siete veces tapaba lo que sale cada día.
 */
export function diaEnLaAgenda(pieza: Pick<PiezaMarketing, "scheduled_at" | "ends_at">, dias: readonly string[]): string | null {
  if (dias.length === 0) return null;
  const inicio = fechaEnChile(new Date(pieza.scheduled_at));
  const fin = pieza.ends_at ? fechaEnChile(new Date(pieza.ends_at)) : inicio;
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  if (fin < primero || inicio > ultimo) return null;
  return inicio < primero ? primero : inicio;
}

/** Los días con algo en la agenda, en orden, cada uno con sus publicaciones por hora. */
export function agendaPorDia<T extends Ubicable>(piezas: readonly T[], dias: readonly string[]): { dia: string; piezas: T[] }[] {
  const porDia = new Map<string, T[]>();
  for (const pieza of piezas) {
    const dia = diaEnLaAgenda(pieza, dias);
    if (!dia) continue;
    const lista = porDia.get(dia) ?? [];
    lista.push(pieza);
    porDia.set(dia, lista);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, lista]) => ({
      dia,
      piezas: lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.title.localeCompare(b.title, "es")),
    }));
}

// ---------------------------------------------------------------------------
// Publicaciones cruzadas y espacios de plan
// ---------------------------------------------------------------------------

/**
 * Lo que sale a la vez en varias redes (un reel en Instagram y en Facebook)
 * es una sola publicación en el calendario, con un ícono por red. En la base
 * siguen siendo filas separadas: cada red tiene su estado, su enlace y sus
 * resultados, y el panel las muestra una por una.
 */
export type GrupoMarketing = {
  /** id de la primera pieza: estable mientras la pieza exista. */
  id: string;
  piezas: PiezaMarketing[];
  principal: PiezaMarketing;
  canales: CanalMarketing[];
  title: string;
  format: FormatoMarketing;
  scheduled_at: string;
  /** El fin más tardío del grupo (null si ninguna pieza dura varios días). */
  ends_at: string | null;
  /** El estado que hay que mirar: si las redes no coinciden, el más urgente. */
  estado: EstadoMarketing;
  /** Las redes del grupo no están todas en el mismo estado. */
  mixto: boolean;
  /** Todas sus piezas son espacios de plan de un agente. */
  plan: boolean;
};

/** Del más urgente al más tranquilo: lo que falló o se pausó no se esconde tras un "publicado". */
const PRIORIDAD_ESTADO: readonly EstadoMarketing[] = ["fallido", "pausado", "programado", "borrador", "idea", "publicado"];

/** Mismo título, mismo minuto y mismo formato = la misma publicación. */
export function claveDePublicacion(pieza: Pick<PiezaMarketing, "title" | "scheduled_at" | "format">): string {
  const instante = new Date(pieza.scheduled_at);
  const minuto = Number.isNaN(instante.getTime()) ? pieza.scheduled_at : instante.toISOString().slice(0, 16);
  const titulo = pieza.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return [pieza.format, minuto, titulo].join("|");
}

/** Un espacio que Claude reservó para un agente («Agente 1 · Educador»): todavía no es una pieza con texto. */
export function esEspacioDePlan(pieza: Pick<PiezaMarketing, "source" | "external_id">): boolean {
  return pieza.source === "claude" && typeof pieza.external_id === "string" && pieza.external_id.startsWith("plan-");
}

/** "Dentistas en Chile · Pymes de Chile." → ["Dentistas en Chile", "Pymes de Chile"]. */
export function gruposDelPlan(target: string | null): string[] {
  if (!target) return [];
  return target
    .split(" · ")
    .map((grupo) => grupo.trim().replace(/\.$/, "").trim())
    .filter(Boolean);
}

export function agruparPublicaciones(piezas: readonly PiezaMarketing[]): GrupoMarketing[] {
  const abiertos = new Map<string, PiezaMarketing[][]>();
  const grupos: PiezaMarketing[][] = [];
  for (const pieza of piezas) {
    const clave = claveDePublicacion(pieza);
    const candidatos = abiertos.get(clave) ?? [];
    // Dos piezas del mismo canal no se juntan: son dos publicaciones, no una cruzada.
    const destino = candidatos.find((grupo) => !grupo.some((otra) => otra.channel === pieza.channel));
    if (destino) {
      destino.push(pieza);
    } else {
      const nuevo = [pieza];
      candidatos.push(nuevo);
      abiertos.set(clave, candidatos);
      grupos.push(nuevo);
    }
  }

  return grupos
    .map((lista): GrupoMarketing => {
      const ordenadas = [...lista].sort((a, b) => CANALES_MARKETING.indexOf(a.channel) - CANALES_MARKETING.indexOf(b.channel));
      const principal = ordenadas[0];
      const estados = new Set(ordenadas.map((pieza) => pieza.status));
      const fines = ordenadas.map((pieza) => pieza.ends_at).filter((fin): fin is string => Boolean(fin));
      return {
        id: principal.id,
        piezas: ordenadas,
        principal,
        canales: ordenadas.map((pieza) => pieza.channel),
        title: principal.title,
        format: principal.format,
        scheduled_at: principal.scheduled_at,
        ends_at: fines.length ? fines.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null,
        estado: PRIORIDAD_ESTADO.find((estado) => estados.has(estado)) ?? principal.status,
        mixto: estados.size > 1,
        plan: ordenadas.every(esEspacioDePlan),
      };
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.title.localeCompare(b.title, "es"));
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export type ResumenMarketing = {
  /** Piezas (filas) del rango: un reel en Instagram y en Facebook son dos. */
  total: number;
  /** Canales distintos con al menos una pieza. */
  canales: number;
  porEstado: Partial<Record<EstadoMarketing, number>>;
  porCanal: Partial<Record<CanalMarketing, number>>;
  leads: number;
  /** Espacios de plan de los agentes (todavía sin pieza propia). */
  planes: number;
};

type Resumible = Pick<PiezaMarketing, "status" | "channel" | "metrics"> & Partial<Pick<PiezaMarketing, "source" | "external_id">>;

export function resumenDelRango(piezas: readonly Resumible[]): ResumenMarketing {
  const resumen: ResumenMarketing = { total: piezas.length, canales: 0, porEstado: {}, porCanal: {}, leads: 0, planes: 0 };
  for (const pieza of piezas) {
    resumen.porEstado[pieza.status] = (resumen.porEstado[pieza.status] ?? 0) + 1;
    resumen.porCanal[pieza.channel] = (resumen.porCanal[pieza.channel] ?? 0) + 1;
    const leads = Number(pieza.metrics?.leads);
    if (Number.isFinite(leads) && leads > 0) resumen.leads += leads;
    if (pieza.source && esEspacioDePlan({ source: pieza.source, external_id: pieza.external_id ?? null })) resumen.planes += 1;
  }
  resumen.canales = Object.keys(resumen.porCanal).length;
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

/** Portada del video, si el alimentador la mandó en las métricas. */
export function portadaDelVideo(metrics: PiezaMarketing["metrics"] | null | undefined): string | undefined {
  const url = metrics?.poster_url;
  return typeof url === "string" && /^https?:\/\/\S+$/i.test(url) ? url : undefined;
}

/** Las cifras de la pieza; lo que no es número (la portada) no es un resultado. */
export function metricasNumericas(metrics: PiezaMarketing["metrics"] | null | undefined): [string, number][] {
  return Object.entries(metrics ?? {}).filter((par): par is [string, number] => typeof par[1] === "number" && Number.isFinite(par[1]));
}

/** Piezas con imagen o video que se pueden mostrar en el panel. */
export function tipoDeArchivo(url: string | null): "imagen" | "video" | "otro" | null {
  if (!url) return null;
  const ruta = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|avif)$/.test(ruta)) return "imagen";
  if (/\.(mp4|webm|mov|m4v)$/.test(ruta)) return "video";
  return "otro";
}
