import {
  Activity,
  BarChart3,
  CalendarClock,
  CircleHelp,
  Database,
  Headphones,
  LayoutDashboard,
  Megaphone,
  PhoneCall,
  Plug,
  ShieldCheck,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "./types";

/**
 * Fuente única de la arquitectura de navegación (ver docs/arquitectura-navegacion.md).
 *
 * Reglas que este archivo hace cumplir:
 *  1. Dos espacios: `console` (operar) y `admin` (configurar). El espacio se deduce
 *     del pathname: todo lo que empieza con /dashboard/admin es el espacio admin.
 *  2. Profundidad máxima 2: sección → ítem. El tercer nivel son `tabs` de página.
 *  3. El menú son sustantivos. Las acciones (crear, importar) son botones en la página.
 *  4. Un concepto, un nombre: el `label` de aquí es el mismo del PageHeader del destino.
 *  5. Sin jerga de proveedor en el menú (Vocalcom, SIP, Equifax viven dentro de la página).
 */

export type NavBadge = "live-agents" | "overdue-agenda";
export type NavSpaceId = "console" | "admin";

export type NavTab = { label: string; href: string; roles?: AppRole[] };

export type NavItem = {
  id: string;
  /** Label único, o por rol cuando el alcance cambia ("Mis registros" vs "Registros"). */
  label: string | ({ default: string } & Partial<Record<AppRole, string>>);
  href: string;
  icon: LucideIcon;
  roles: AppRole[];
  /** Descripción corta reutilizada por la búsqueda global. */
  description: string;
  badge?: NavBadge;
  /** Prefijos extra que mantienen el ítem activo (acciones y vistas hijas). */
  match?: string[];
  /** Pestañas del destino: se pintan en la página, nunca en el sidebar. */
  tabs?: NavTab[];
};

export type NavSection = { id: string; label?: string; items: NavItem[] };

export type NavSpace = {
  id: NavSpaceId;
  label: string;
  roles: AppRole[];
  sections: NavSection[];
};

export const ROLE_LABEL: Record<AppRole, string> = {
  agente: "Agente",
  supervisor: "Supervisor",
  admin: "Administrador",
};

const ALL_ROLES: AppRole[] = ["agente", "supervisor", "admin"];
const OPERACION: AppRole[] = ["supervisor", "admin"];

/** Espacio 1 — Consola: lo que se usa a diario. Sin encabezados de grupo. */
const CONSOLE: NavSpace = {
  id: "console",
  label: "Consola",
  roles: ALL_ROLES,
  sections: [
    {
      id: "console-main",
      items: [
        {
          id: "inicio",
          label: "Inicio",
          href: "/dashboard",
          icon: LayoutDashboard,
          roles: ALL_ROLES,
          description: "Resumen del día y accesos rápidos",
        },
        {
          id: "monitor",
          label: "Monitor en vivo",
          href: "/dashboard/supervision/monitor",
          icon: Activity,
          roles: OPERACION,
          description: "Estado de ejecutivos y llamadas en curso",
          badge: "live-agents",
        },
        {
          id: "equipo",
          label: "Mi equipo",
          href: "/dashboard/team",
          icon: UsersRound,
          roles: ["supervisor"],
          description: "Carga, agendas y asignación de tus ejecutivos",
        },
        {
          id: "registros",
          label: { default: "Registros", agente: "Mis registros" },
          href: "/dashboard/leads",
          icon: Users,
          roles: ALL_ROLES,
          description: "Cartera de registros y su gestión",
          match: ["/dashboard/leads", "/dashboard/llamadas"],
        },
        {
          id: "campanas-operativas",
          label: "Campañas",
          href: "/dashboard/campanas",
          icon: Megaphone,
          roles: OPERACION,
          description: "Operación y canales habilitados por campaña",
        },
        {
          id: "agenda",
          label: "Mi agenda",
          href: "/dashboard/agenda",
          icon: CalendarClock,
          roles: ["agente"],
          description: "Seguimientos de hoy y vencidos",
          badge: "overdue-agenda",
        },
        {
          id: "reportes",
          label: "Reportes",
          href: "/dashboard/reportes",
          icon: BarChart3,
          roles: OPERACION,
          description: "Indicadores de gestión y de discador",
          tabs: [
            { label: "Gestión", href: "/dashboard/reportes" },
            { label: "Discador", href: "/dashboard/reportes/discador" },
            // Señales de tipificación automatizada: es información sobre el
            // desempeño individual que puede escalar a un proceso disciplinario.
            { label: "Integridad", href: "/dashboard/reportes/integridad", roles: ["admin", "supervisor"] },
          ],
        },
        {
          id: "calidad",
          label: "Calidad",
          href: "/dashboard/calidad",
          icon: Headphones,
          roles: OPERACION,
          description: "Grabaciones post-llamada para revisión y control de calidad",
        },
      ],
    },
  ],
};

/** Espacio 2 — Administración: configuración de la plataforma. Solo admin. */
const ADMIN: NavSpace = {
  id: "admin",
  label: "Administración",
  roles: ["admin"],
  sections: [
    {
      id: "admin-operacion",
      label: "Operación",
      items: [
        {
          id: "campanas",
          label: "Campañas",
          href: "/dashboard/admin/campanas",
          icon: Megaphone,
          roles: ["admin"],
          description: "Configuración y estado de cada operación",
        },
        {
          id: "flujos",
          label: "Flujos de gestión",
          href: "/dashboard/admin/flujos",
          icon: Workflow,
          roles: ["admin"],
          description: "Guiones, pasos y tipificaciones",
        },
        {
          id: "estados-agente",
          label: "Estados de agente",
          href: "/dashboard/admin/estados-agente",
          icon: UserCog,
          roles: ["admin"],
          description: "Catálogo de estados del discador",
        },
        {
          id: "cargas",
          label: "Cargas y listas",
          href: "/dashboard/admin/cargas",
          icon: Database,
          roles: ["admin"],
          description: "Importación de bases y su historial",
        },
      ],
    },
    {
      id: "admin-plataforma",
      label: "Plataforma",
      items: [
        {
          id: "usuarios",
          label: "Usuarios y equipos",
          href: "/dashboard/admin/usuarios",
          icon: ShieldCheck,
          roles: ["admin"],
          description: "Roles, equipos y supervisores",
        },
        {
          id: "extensiones",
          label: "Extensiones SIP",
          href: "/dashboard/admin/agentes-sip",
          icon: PhoneCall,
          roles: ["admin"],
          description: "Anexos y credenciales de telefonía",
        },
        {
          id: "integraciones",
          label: "Integraciones",
          href: "/dashboard/admin/integraciones",
          icon: Plug,
          roles: ["admin"],
          description: "Importación y datos heredados del proveedor externo",
          tabs: [
            { label: "Importar gestión", href: "/dashboard/admin/integraciones" },
            { label: "Ejecutivos históricos", href: "/dashboard/admin/integraciones/historial" },
          ],
        },
      ],
    },
  ],
};

export const NAV_SPACES: NavSpace[] = [CONSOLE, ADMIN];

/** Ayuda vive en el pie del menú, transversal a los dos espacios. */
export const HELP_ITEM: NavItem = {
  id: "ayuda",
  label: "Ayuda",
  href: "/dashboard/ayuda",
  icon: CircleHelp,
  roles: ALL_ROLES,
  description: "Guías de la operación por rol",
};

export const HELP_HREF = HELP_ITEM.href;

/** Resuelve el label del ítem para un rol concreto. */
export function navLabel(item: NavItem, role: AppRole): string {
  return typeof item.label === "string" ? item.label : item.label[role] ?? item.label.default;
}

/** Espacio al que pertenece una ruta. */
export function spaceForPath(pathname: string): NavSpaceId {
  return pathname.startsWith("/dashboard/admin") ? "admin" : "console";
}

export function getSpace(id: NavSpaceId): NavSpace {
  return NAV_SPACES.find((space) => space.id === id) ?? CONSOLE;
}

/** Secciones visibles de un espacio para un rol, ya filtradas y sin secciones vacías. */
export function visibleSections(spaceId: NavSpaceId, role: AppRole): NavSection[] {
  return getSpace(spaceId)
    .sections.map((section) => ({ ...section, items: section.items.filter((item) => item.roles.includes(role)) }))
    .filter((section) => section.items.length > 0);
}

/** Todos los ítems accesibles por un rol, en orden de menú (usado por la búsqueda global). */
export function allItemsForRole(role: AppRole): NavItem[] {
  const items = NAV_SPACES.filter((space) => space.roles.includes(role)).flatMap((space) =>
    space.sections.flatMap((section) => section.items.filter((item) => item.roles.includes(role)))
  );
  return [...items, HELP_ITEM];
}

/** ¿La ruta actual corresponde a este ítem? Considera `match` y evita que /dashboard capture todo. */
export function isItemActive(item: NavItem, pathname: string): boolean {
  const prefixes = item.match ?? [item.href];
  return prefixes.some((prefix) =>
    prefix === "/dashboard" ? pathname === prefix : pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

/** Pestañas declaradas por un ítem, para el layout de ese destino. */
export function getTabs(itemId: string, role?: AppRole): NavTab[] {
  const item = NAV_SPACES.flatMap((space) => space.sections.flatMap((section) => section.items)).find(
    (candidate) => candidate.id === itemId
  );
  return (item?.tabs ?? []).filter((tab) => !tab.roles || !role || tab.roles.includes(role));
}

/** Pestañas del destino que contiene la ruta actual (para el PageHeader). */
export function tabsForPath(pathname: string, role: AppRole): NavTab[] {
  const item = allItemsForRole(role).find((candidate) => candidate.tabs && isItemActive(candidate, pathname));
  return (item?.tabs ?? []).filter((tab) => !tab.roles || tab.roles.includes(role));
}
