/**
 * Campañas de terreno: vendedores que visitan comercios con el teléfono en la
 * mano, sin llamar desde Atlas. La primera es Mercado Pago (lectores Point).
 *
 * El embudo y los motivos son los mismos que valida la base
 * (20261009120000_campana_de_terreno_mercado_pago.sql); si cambian allá,
 * cambian acá.
 */

import type { BadgeTone } from "@/components/ui/badge";

export const ETAPAS = ["no_visitado", "visitado", "interesado", "documentos", "vendido", "descartado"] as const;
export type Etapa = (typeof ETAPAS)[number];

/** Lo que el vendedor puede marcar al registrar una visita. */
export const RESULTADOS = ["visitado", "interesado", "documentos", "vendido", "descartado"] as const;
export type Resultado = (typeof RESULTADOS)[number];

export const ETAPA_INFO: Record<Etapa, { label: string; corto: string; hint: string; tone: BadgeTone }> = {
  no_visitado: { label: "No visitado", corto: "Por visitar", hint: "Aún no pasas por el local", tone: "neutral" },
  visitado: { label: "Visitado", corto: "Visitado", hint: "Sin decisor o hay que volver", tone: "info" },
  interesado: { label: "Interesado", corto: "Interesado", hint: "Quiere el lector", tone: "warning" },
  documentos: { label: "Documentos / alta en MP", corto: "Alta en MP", hint: "Juntando papeles o abriendo la cuenta", tone: "warning" },
  vendido: { label: "POS vendido", corto: "Vendido", hint: "Compró el lector", tone: "success" },
  descartado: { label: "No sigue", corto: "No sigue", hint: "No interesado, cerrado o no ubicado", tone: "danger" },
};

export const MOTIVOS = ["no_interesado", "cerrado", "no_ubicado"] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const MOTIVO_LABEL: Record<Motivo, string> = {
  no_interesado: "No le interesa",
  cerrado: "Local cerrado",
  no_ubicado: "No lo ubiqué",
};

/** Sugerencias; el vendedor puede escribir otro modelo. */
export const MODELOS_POINT = ["Point Mini", "Point Smart", "Point Pro", "Otro"] as const;

export function esEtapa(value: unknown): value is Etapa {
  return typeof value === "string" && (ETAPAS as readonly string[]).includes(value);
}

export function esResultado(value: unknown): value is Resultado {
  return typeof value === "string" && (RESULTADOS as readonly string[]).includes(value);
}

export function esMotivo(value: unknown): value is Motivo {
  return typeof value === "string" && (MOTIVOS as readonly string[]).includes(value);
}

export type CampanaTerreno = { id: string; name: string };

export type FichaTerreno = {
  lead_id: string;
  campaign_id: string;
  vendedor_id: string;
  etapa: Etapa;
  motivo_salida: Motivo | null;
  nombre_contacto: string | null;
  rubro: string | null;
  direccion: string | null;
  comuna: string | null;
  region: string | null;
  completado_con: "bigdata" | "atlas" | null;
  pos_cantidad: number | null;
  pos_modelo: string | null;
  visitas: number;
  ultima_visita_at: string | null;
  /** Cuándo quedó en volver; vacío si no se acordó o si ya salió del embudo. */
  proxima_visita_at: string | null;
  etapa_at: string;
  created_at: string;
};

export type ClienteTerreno = FichaTerreno & {
  lead: { id: string; full_name: string; rut: string | null; phone: string | null; email: string | null } | null;
};

export type VisitaTerreno = {
  id: string;
  lead_id: string;
  vendedor_id: string;
  etapa_antes: Etapa;
  etapa: Resultado;
  motivo_salida: Motivo | null;
  nota: string | null;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  sin_ubicacion: string | null;
  foto_path: string | null;
  pos_cantidad: number | null;
  pos_modelo: string | null;
  created_at: string;
};

export type EmbudoVendedor = {
  vendedor_id: string;
  vendedor: string;
  clientes: number;
  visitados: number;
  interesados: number;
  documentos: number;
  vendidos: number;
  descartados: number;
  visitas: number;
  visitas_con_gps: number;
  visitas_con_foto: number;
  ventas: number;
  lectores: number;
  dias_activos: number;
  ultima_visita_at: string | null;
};

/** Datos del comercio que el vendedor completa. */
export type DatosCliente = {
  full_name: string;
  rut: string;
  phone: string;
  email: string;
  nombre_contacto: string;
  rubro: string;
  direccion: string;
  comuna: string;
  region: string;
};

export const DATOS_VACIOS: DatosCliente = {
  full_name: "",
  rut: "",
  phone: "",
  email: "",
  nombre_contacto: "",
  rubro: "",
  direccion: "",
  comuna: "",
  region: "",
};

/** Campos que faltan para que la ficha esté completa (sin contar RUT y correo). */
export function camposFaltantes(datos: Partial<DatosCliente>): (keyof DatosCliente)[] {
  const clave: (keyof DatosCliente)[] = ["phone", "nombre_contacto", "direccion", "comuna", "rubro"];
  return clave.filter((campo) => !datos[campo]?.trim());
}

export const CAMPO_LABEL: Record<keyof DatosCliente, string> = {
  full_name: "Nombre del comercio",
  rut: "RUT",
  phone: "Teléfono",
  email: "Correo",
  nombre_contacto: "Persona de contacto",
  rubro: "Rubro",
  direccion: "Dirección",
  comuna: "Comuna",
  region: "Región",
};

/** Enlace a Google Maps: por coordenadas si hay, si no por dirección. */
export function mapaHref(opts: { lat?: number | null; lng?: number | null; direccion?: string | null; comuna?: string | null }) {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${opts.lat},${opts.lng}`;
  }
  const texto = [opts.direccion, opts.comuna, "Chile"].filter(Boolean).join(", ");
  return opts.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}` : null;
}
