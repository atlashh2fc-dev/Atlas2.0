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

/**
 * Cómo habla el embudo de ventas en cada edición.
 *
 * Center vende a empresas con un monto mensual. Una clínica vende a personas un
 * presupuesto de pago único: la "cuenta" es el paciente (o el tutor de la
 * mascota) y el monto que importa es `one_time_amount`. Es el mismo embudo y la
 * misma tabla; cambia qué columna se suma y cómo se llama cada cosa.
 */
export type VocabularioVentas = {
  titulo: string;
  descripcion: string;
  /** A quién se le vende. */
  cuenta: string;
  cuentaPlaceholder: string;
  /** Lo que se cierra. */
  negocio: string;
  negocios: string;
  negocioPlaceholder: string;
  nuevo: string;
  producto: string;
  /** B2C: la cuenta es una persona y no hay un contacto aparte. */
  personas: boolean;
  /** Qué monto se suma en el embudo. */
  monto: "mensual" | "unico";
  origenes: { value: string; label: string }[];
};

const ORIGENES_B2C = [
  { value: "instagram", label: "Instagram" },
  { value: "google", label: "Google" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referido", label: "Referido" },
  { value: "convenio", label: "Convenio" },
  { value: "web", label: "Sitio web" },
];

export const VENTAS_POR_EDICION: Record<Edicion, VocabularioVentas> = {
  center: {
    titulo: "Ventas",
    descripcion: "Empresas que pueden contratar, con su monto, su etapa y lo que toca hacer.",
    cuenta: "Empresa",
    cuentaPlaceholder: "Panadería La Espiga Ltda",
    negocio: "Negocio",
    negocios: "Negocios",
    negocioPlaceholder: "Atlas Pulso Crecimiento",
    nuevo: "Nueva oportunidad",
    producto: "Producto",
    personas: false,
    monto: "mensual",
    origenes: [
      { value: "campana_correo", label: "Campaña de correo" },
      { value: "whatsapp", label: "WhatsApp" },
      { value: "web", label: "Sitio web" },
      { value: "referido", label: "Referido" },
      { value: "prospeccion", label: "Prospección" },
    ],
  },
  dental: {
    titulo: "Presupuestos",
    descripcion: "Tratamientos presupuestados, en qué va cada uno y a quién hay que llamar hoy.",
    cuenta: "Paciente",
    cuentaPlaceholder: "Camila Rojas",
    negocio: "Presupuesto",
    negocios: "Presupuestos",
    negocioPlaceholder: "Implante pieza 36",
    nuevo: "Nuevo presupuesto",
    producto: "Tratamiento",
    personas: true,
    monto: "unico",
    origenes: ORIGENES_B2C,
  },
  vet: {
    titulo: "Planes de tratamiento",
    descripcion: "Planes enviados a los tutores, en qué va cada uno y a quién hay que llamar hoy.",
    cuenta: "Tutor",
    cuentaPlaceholder: "Javiera Muñoz",
    negocio: "Plan",
    negocios: "Planes",
    negocioPlaceholder: "Esterilización · Luna",
    nuevo: "Nuevo plan",
    producto: "Servicio",
    personas: true,
    monto: "unico",
    origenes: ORIGENES_B2C,
  },
};
