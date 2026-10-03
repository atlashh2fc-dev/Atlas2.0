import { HELP_ITEM, NAV_SPACES, isItemActive, type NavItem } from "@/lib/nav.config";

/** Tonos de los chips de icono (`.icon-chip[data-tone]` en globals.css). */
export type Tone = "primary" | "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate";

/**
 * Tono de cada destino del menú. Agrupa por naturaleza y no por sección, para
 * que el mismo destino tenga el mismo color en cualquier menú, rol y pantalla:
 * comunicación en turquesa, agenda en ámbar, dinero en verde, análisis en
 * violeta, personas en azul, campañas en rosa y configuración en gris.
 */
export const NAV_TONE: Record<string, Tone> = {
  inicio: "primary",
  operacion: "teal",
  correo: "teal",
  "correo-clinica": "teal",
  conversaciones: "teal",
  "conversaciones-clinica": "teal",
  recordatorios: "teal",
  agenda: "amber",
  "agenda-clinica": "amber",
  ventas: "green",
  caja: "green",
  "validacion-ventas": "green",
  aranceles: "green",
  reportes: "violet",
  "reportes-clinica": "violet",
  calidad: "violet",
  pacientes: "blue",
  registros: "blue",
  equipo: "blue",
  "usuarios-equipo": "blue",
  usuarios: "blue",
  empresas: "blue",
  campanas: "rose",
  "campanas-clinica": "rose",
  "campanas-operativas": "rose",
  marketing: "rose",
  colas: "rose",
  flujos: "rose",
  ayuda: "blue",
};

export const navTone = (id: string): Tone => NAV_TONE[id] ?? "slate";

const ALL_ITEMS: NavItem[] = [
  ...NAV_SPACES.flatMap((space) => space.sections.flatMap((section) => section.items)),
  HELP_ITEM,
];

/** Destino del menú que contiene la ruta: gana el prefijo más largo. */
export function navItemForPath(pathname: string): NavItem | null {
  let best: { item: NavItem; length: number } | null = null;
  for (const item of ALL_ITEMS) {
    if (!isItemActive(item, pathname)) continue;
    const length = Math.max(
      ...(item.match ?? [item.href]).filter((prefix) => pathname.startsWith(prefix)).map((prefix) => prefix.length),
      0,
    );
    if (!best || length > best.length) best = { item, length };
  }
  return best?.item ?? null;
}
