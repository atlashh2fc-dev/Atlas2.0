/**
 * Atlas Suite: qué aplicaciones tiene contratada cada empresa.
 *
 * La suite se arma por partes, como Odoo: una empresa toma el contact center,
 * otra solo leads y ventas, otra suma finanzas, mesa de ayuda o capacitación.
 * El catálogo es el mismo que se vende en altiusignite.com, para que no exista
 * un producto en la web que la plataforma no sepa activar.
 *
 * La verdad vive en `organization_modules` y se lee con la empresa que la
 * persona está mirando. Acá solo se transporta: si esto se decidiera en la
 * pantalla, una URL escrita a mano se saltaría la frontera.
 */

export const APP_MODULES = [
  "leads",
  "ventas_b2b",
  "ventas_b2c",
  "contact_center",
  "correo",
  "whatsapp",
  "bigdata",
  "analytics",
  "itsm",
  "finanzas",
  "aprende",
] as const;

export type AppModule = (typeof APP_MODULES)[number];

export type ModuleInfo = {
  label: string;
  /** Producto del catálogo público al que pertenece. */
  producto: string;
  description: string;
  /** Se opera dentro de Atlas 2.0, o es un sistema aparte de la suite. */
  dentro: boolean;
};

export const MODULE_INFO: Record<AppModule, ModuleInfo> = {
  leads: {
    label: "Leads",
    producto: "Atlas 2.0",
    description: "Registros, reparto y seguimiento hasta el cierre",
    dentro: true,
  },
  ventas_b2b: {
    label: "Ventas B2B",
    producto: "Atlas 2.0",
    description: "Embudo de empresas: monto mensual, etapa y próxima acción",
    dentro: true,
  },
  ventas_b2c: {
    label: "Ventas B2C",
    producto: "Atlas 2.0",
    description: "Venta directa a consumidor final",
    dentro: true,
  },
  contact_center: {
    label: "Contact center",
    producto: "Atlas CRM",
    description: "Voz, discador, agentes, colas, grabaciones y calidad",
    dentro: true,
  },
  correo: {
    label: "Campañas de correo",
    producto: "Atlas Lead",
    description: "Audiencias, envíos, respuestas e incidencias",
    dentro: true,
  },
  whatsapp: {
    label: "WhatsApp",
    producto: "Atlas CRM",
    description: "Conversaciones por WhatsApp, con o sin IA",
    dentro: true,
  },
  bigdata: {
    label: "Datos y priorización",
    producto: "Atlas Scoring",
    description: "Completar datos por RUT y priorizar la base comercial",
    dentro: false,
  },
  analytics: {
    label: "Tableros",
    producto: "Atlas Analytics",
    description: "Indicadores de gestión compartidos entre áreas",
    dentro: false,
  },
  itsm: {
    label: "Mesa de ayuda",
    producto: "Atlas ITSM",
    description: "Solicitudes, inventario, conocimiento y soporte remoto",
    dentro: false,
  },
  finanzas: {
    label: "Finanzas",
    producto: "Atlas Financiero",
    description: "Documentos del SII, tesorería, cartera y proyecciones",
    dentro: false,
  },
  aprende: {
    label: "Capacitación",
    producto: "Atlas Aprende",
    description: "Formación de los equipos y su avance",
    dentro: false,
  },
};

export const MODULE_LABEL: Record<AppModule, string> = Object.fromEntries(
  APP_MODULES.map((modulo) => [modulo, MODULE_INFO[modulo].label]),
) as Record<AppModule, string>;

/** Aplicaciones que se operan dentro de Atlas 2.0; el resto son sistemas aparte. */
export const MODULOS_INTERNOS: AppModule[] = APP_MODULES.filter((modulo) => MODULE_INFO[modulo].dentro);

export function esModulo(valor: unknown): valor is AppModule {
  return typeof valor === "string" && (APP_MODULES as readonly string[]).includes(valor);
}
