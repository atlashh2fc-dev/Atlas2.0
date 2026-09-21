/**
 * Ediciones de Atlas: el mismo CRM vendido a industrias distintas.
 *
 * La edición es un hecho de la empresa (`organizations.edicion`) y decide tres
 * cosas: con qué nace (la plantilla, que vive en la base), cómo se ve (el color
 * de acento, que vive en `globals.css` bajo `[data-edicion]`) y cómo se presenta
 * (el sufijo del logo, que vive acá). Ninguna pantalla pregunta "¿es dental?":
 * leen el color de las variables de siempre y el nombre de este catálogo.
 */

export const EDICIONES = ["center", "dental", "vet"] as const;

export type Edicion = (typeof EDICIONES)[number];

export type EdicionInfo = {
  /** Lo que acompaña a "Atlas" en el logo. */
  sufijo: string;
  label: string;
  description: string;
};

export const EDICION_INFO: Record<Edicion, EdicionInfo> = {
  center: {
    sufijo: "Center",
    label: "Atlas Center",
    description: "Contact center: campañas, discador, agentes, colas y calidad.",
  },
  dental: {
    sufijo: "Dental",
    label: "Atlas Dental",
    description: "Clínicas dentales: presupuestos por tratamiento, seguimiento y WhatsApp.",
  },
  vet: {
    sufijo: "Vet",
    label: "Atlas Vet",
    description: "Veterinarias: controles, vacunas, recompra y WhatsApp con el tutor.",
  },
};

export function esEdicion(valor: unknown): valor is Edicion {
  return typeof valor === "string" && (EDICIONES as readonly string[]).includes(valor);
}

/** Lo desconocido cae en Center, que es como se comportaba todo antes de esto. */
export function parseEdicion(valor: unknown): Edicion {
  return esEdicion(valor) ? valor : "center";
}
