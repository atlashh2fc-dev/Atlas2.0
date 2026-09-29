/**
 * Las pestañas de Ventas, en el orden en que piensa el dueño del negocio:
 * a quién le escribo hoy, cómo van mis negocios y cuánto vendí. Tablero y
 * lista son dos formas de ver lo mismo, así que viven en la misma pestaña; las
 * respuestas del agente son gente por contactar, así que viven en la primera.
 */
export const PESTANAS_VENTAS = [
  { label: "Por contactar", href: "/dashboard/ventas/prospeccion" },
  { label: "Negocios", href: "/dashboard/pipeline", match: ["/dashboard/ventas"] },
  { label: "Resultados", href: "/dashboard/ventas/resultados" },
];

/** Las dos formas de ver los negocios. */
export const VISTAS_NEGOCIOS = [
  { clave: "tablero", texto: "Tablero", href: "/dashboard/pipeline" },
  { clave: "lista", texto: "Lista", href: "/dashboard/ventas" },
];
