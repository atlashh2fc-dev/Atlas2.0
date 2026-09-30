/**
 * Ediciones de Atlas: el mismo CRM vendido a industrias distintas.
 *
 * La edición es un hecho de la empresa (`organizations.edicion`) y decide tres
 * cosas: con qué nace (la plantilla, que vive en la base), cómo se ve (el color
 * de acento, que vive en `globals.css` bajo `[data-edicion]`) y cómo se presenta
 * (el sufijo del logo, que vive acá). Ninguna pantalla pregunta "¿es dental?":
 * leen el color de las variables de siempre y el nombre de este catálogo.
 */

export const EDICIONES = ["center", "dental", "vet", "barber"] as const;

export type Edicion = (typeof EDICIONES)[number];

/** Las ediciones que atienden a personas por agenda: todas menos Center. */
export type Clinica = Exclude<Edicion, "center">;

/**
 * La edición de atención que corresponde. Center no tiene pantallas de agenda;
 * si alguna llega igual (un enlace viejo), se comporta como Dental, que es
 * como se comportaba todo antes de que existieran Vet y Barber.
 */
export function clinicaDe(edicion: Edicion): Clinica {
  return edicion === "center" ? "dental" : edicion;
}

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
  barber: {
    sufijo: "Barber",
    label: "Atlas Barber",
    description: "Barberías: agenda por barbero, caja, mantención del corte y Estudio de Look con IA.",
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
    nuevo: "Nuevo negocio",
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
  barber: {
    titulo: "Paquetes",
    descripcion: "Paquetes y planes ofrecidos a los clientes, en qué va cada uno y a quién hay que escribir hoy.",
    cuenta: "Cliente",
    cuentaPlaceholder: "Matías Fuentes",
    negocio: "Paquete",
    negocios: "Paquetes",
    negocioPlaceholder: "Plan mensual corte + barba",
    nuevo: "Nuevo paquete",
    producto: "Servicio",
    personas: true,
    monto: "unico",
    origenes: ORIGENES_B2C,
  },
};

/**
 * Cómo se llama la ficha de la persona en cada clínica. En Dental es el
 * paciente; en Vet la ficha es del tutor, que tiene una o varias mascotas.
 */
export const PACIENTES_POR_EDICION: Record<Clinica, {
  titulo: string;
  singular: string;
  nuevo: string;
  descripcion: string;
}> = {
  dental: {
    titulo: "Pacientes",
    singular: "Paciente",
    nuevo: "Nuevo paciente",
    descripcion: "La ficha de cada paciente: contacto, previsión, presupuestos y todo lo conversado.",
  },
  vet: {
    titulo: "Tutores y mascotas",
    singular: "Tutor",
    nuevo: "Nuevo tutor",
    descripcion: "Cada tutor con sus mascotas, sus vacunas y todo lo conversado.",
  },
  barber: {
    titulo: "Clientes",
    singular: "Cliente",
    nuevo: "Nuevo cliente",
    descripcion: "Cada cliente con sus cortes, sus looks aprobados y todo lo conversado.",
  },
};

/**
 * Quién atiende en cada edición y cómo se llama lo que se hace. Lo usan la
 * agenda, la ficha y los recordatorios para no hablar de "doctora" en una
 * barbería.
 */
export const ATENCION_POR_EDICION: Record<Clinica, {
  profesional: string;
  profesionales: string;
  /** Cómo se nombra el negocio en una frase: "la clínica", "la barbería". */
  lugar: string;
  atencion: string;
  /** Cómo se llama una hora en la agenda. */
  cita: string;
  citas: string;
  registrar: string;
  motivoPlaceholder: string;
  notaPlaceholder: string;
  /** Desde cuántos días sin atención se le escribe para que vuelva. */
  diasSinVenir: number;
  /** Cómo se dice ese plazo y por qué importa. */
  plazoSinVenir: string;
  porQueVolver: string;
  plantillaVuelta: "control" | "mantencion";
}> = {
  dental: {
    profesional: "Profesional",
    profesionales: "Profesionales",
    lugar: "la clínica",
    atencion: "Cita",
    cita: "cita",
    citas: "citas",
    registrar: "Registrar atención",
    motivoPlaceholder: "Control · limpieza · restauración",
    notaPlaceholder: "Paciente pide cuotas para el implante",
    diasSinVenir: 180,
    plazoSinVenir: "6 meses",
    porQueVolver: "El control semestral: la visita que mantiene la boca sana y la agenda llena. Una vez al mes.",
    plantillaVuelta: "control",
  },
  vet: {
    profesional: "Veterinario",
    profesionales: "Veterinarios",
    lugar: "la clínica",
    atencion: "Consulta",
    cita: "cita",
    citas: "citas",
    registrar: "Registrar atención",
    motivoPlaceholder: "Control · vacuna · esterilización",
    notaPlaceholder: "Tutor confirma hora de vacuna",
    diasSinVenir: 365,
    plazoSinVenir: "12 meses",
    porQueVolver: "Un control anual es la visita que más se olvida y la que más recompra trae. Una vez al mes.",
    plantillaVuelta: "control",
  },
  barber: {
    profesional: "Barbero",
    profesionales: "Barberos",
    lugar: "la barbería",
    atencion: "Reserva",
    cita: "reserva",
    citas: "reservas",
    registrar: "Registrar servicio",
    motivoPlaceholder: "Corte · barba · fade",
    notaPlaceholder: "Cliente quiere probar un mid fade",
    diasSinVenir: 35,
    plazoSinVenir: "5 semanas",
    porQueVolver: "Un corte pierde la forma a las 3 a 5 semanas: la mantención es la visita que llena la agenda. Una vez por semana.",
    plantillaVuelta: "mantencion",
  },
};
