import {
  Activity,
  BarChart3,
  CalendarClock,
  CircleHelp,
  Database,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Network,
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
import { getWorkspacePermissions } from "./workspace-permissions";

/**
 * Fuente única de la arquitectura de navegación (ver docs/arquitectura-navegacion.md).
 *
 * Reglas que este archivo hace cumplir:
 *  1. Tres experiencias diarias: Control, Supervisión y Atención. Administración
 *     es un espacio de configuración separado; no concede funciones de agente.
 *  2. Profundidad máxima 2: sección → ítem. El tercer nivel son `tabs` de página.
 *  3. El menú son sustantivos. Las acciones (crear, importar) son botones en la página.
 *  4. La tarea y el alcance determinan el nombre; no se simula un cambio de rol.
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

/** Inventario compartido. WORKSPACE_SECTIONS define la arquitectura de cada rol. */
const CONSOLE: NavSpace = {
  id: "console",
  label: "Consola",
  roles: ALL_ROLES,
  sections: [
    {
      id: "console-home",
      items: [
        {
          id: "inicio",
          label: { default: "Resumen", agente: "Mi jornada" },
          href: "/dashboard",
          icon: LayoutDashboard,
          roles: ALL_ROLES,
          description: "Prioridades e indicadores de tu espacio de trabajo",
        },
      ],
    },
    {
      id: "console-operation",
      label: "Operación",
      items: [
        {
          id: "operacion",
          label: "Operación",
          href: "/dashboard/operacion",
          icon: Activity,
          roles: OPERACION,
          description: "Colas de Voice y WhatsApp, capacidad y excepciones; sin atender clientes",
          badge: "live-agents",
          match: ["/dashboard/operacion", "/dashboard/supervision/monitor"],
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
          id: "campanas-operativas",
          label: "Campañas",
          href: "/dashboard/campanas",
          icon: Megaphone,
          roles: OPERACION,
          description: "Operación y canales habilitados por campaña",
        },
        {
          id: "registros",
          label: { default: "Registros", agente: "Mis registros" },
          href: "/dashboard/leads",
          icon: Users,
          roles: ALL_ROLES,
          description: "Registros dentro de tu alcance; gestión solo para ejecutivos",
          match: ["/dashboard/leads", "/dashboard/llamadas"],
        },
        {
          id: "conversaciones",
          label: { default: "Historial", agente: "Mi atención" },
          href: "/dashboard/conversaciones",
          icon: MessageCircle,
          roles: ["agente", "supervisor"],
          description: "Atención asignada para ejecutivos; consulta de historial para supervisión",
          // El índice redirige al primer canal habilitado en la campaña, así
          // que el ítem tiene que seguir activo en /voz, /whatsapp y /correo.
          match: ["/dashboard/conversaciones"],
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
      ],
    },
    {
      id: "console-control",
      label: "Control",
      items: [
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
          label: "Grabaciones y calidad",
          href: "/dashboard/calidad/grabaciones",
          icon: Headphones,
          roles: OPERACION,
          description: "Grabaciones, transcripciones y análisis de calidad",
          match: ["/dashboard/calidad"],
          tabs: [
            { label: "Grabaciones", href: "/dashboard/calidad/grabaciones" },
            { label: "Reportes y análisis", href: "/dashboard/calidad/analisis" },
            { label: "Loop IA", href: "/dashboard/calidad/loop" },
          ],
        },
      ],
    },
  ],
};

/**
 * Estructura explícita por responsabilidad: no es el mismo árbol con botones
 * ocultos. Los ítems comparten definición para que móvil, búsqueda y sidebar
 * mantengan las mismas rutas, etiquetas y permisos.
 */
const WORKSPACE_SECTIONS: Record<AppRole, { id: string; label?: string; itemIds: string[] }[]> = {
  admin: [
    { id: "control-home", itemIds: ["inicio"] },
    { id: "control-operation", label: "Control diario", itemIds: ["operacion", "registros"] },
    { id: "control-results", label: "Revisión", itemIds: ["reportes", "calidad"] },
    { id: "admin-operation", label: "Configuración", itemIds: ["campanas", "colas", "flujos", "estados-agente", "cargas"] },
    { id: "admin-platform", label: "Plataforma", itemIds: ["usuarios", "extensiones", "integraciones"] },
  ],
  supervisor: [
    { id: "supervision-home", itemIds: ["inicio"] },
    { id: "supervision-operation", label: "Supervisión", itemIds: ["operacion", "equipo", "campanas-operativas", "registros"] },
    { id: "supervision-review", label: "Revisión y resultados", itemIds: ["conversaciones", "calidad", "reportes"] },
  ],
  agente: [
    { id: "attention-workspace", itemIds: ["inicio", "conversaciones", "registros", "agenda"] },
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
          id: "colas",
          label: "Colas y enrutamiento",
          href: "/dashboard/admin/colas",
          icon: Network,
          roles: ["admin"],
          description: "Distribución omnicanal, capacidad, SLA y miembros",
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
          label: "Telefonía · diagnóstico",
          href: "/dashboard/admin/agentes-sip",
          icon: PhoneCall,
          roles: ["admin"],
          description: "Salud de anexos automáticos y acciones de contingencia",
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
            { label: "WhatsApp", href: "/dashboard/admin/integraciones/whatsapp" },
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

/** Etiqueta del espacio real, no un selector que permita asumir otro rol. */
export function workspaceLabel(role: AppRole): string {
  if (role === "admin") return "Administración";
  return getWorkspacePermissions(role).workspaceLabel;
}

/** Secciones visibles de un espacio para un rol, ya filtradas y sin secciones vacías. */
export function visibleSections(spaceId: NavSpaceId, role: AppRole): NavSection[] {
  if (role === "admin") {
    const inventory = new Map(
      [...CONSOLE.sections, ...ADMIN.sections]
        .flatMap((section) => section.items)
        .map((item) => [item.id, item])
    );
    return WORKSPACE_SECTIONS.admin
      .map(({ id, label, itemIds }) => ({
        id,
        label,
        items: itemIds.flatMap((itemId) => {
          const item = inventory.get(itemId);
          return item?.roles.includes(role) ? [item] : [];
        }),
      }))
      .filter((section) => section.items.length > 0);
  }
  const space = getSpace(spaceId);
  if (!space.roles.includes(role)) return [];
  if (spaceId === "console") {
    const inventory = new Map(space.sections.flatMap((section) => section.items).map((item) => [item.id, item]));
    return WORKSPACE_SECTIONS[role].map(({ id, label, itemIds }) => ({
      id,
      label,
      items: itemIds.flatMap((itemId) => {
        const item = inventory.get(itemId);
        return item?.roles.includes(role) ? [item] : [];
      }),
    })).filter((section) => section.items.length > 0);
  }
  return space
    .sections.map((section) => ({ ...section, items: section.items.filter((item) => item.roles.includes(role)) }))
    .filter((section) => section.items.length > 0);
}

/** Todos los ítems accesibles por un rol, en orden de menú (usado por la búsqueda global). */
export function allItemsForRole(role: AppRole): NavItem[] {
  const items = role === "admin"
    ? visibleSections("console", role).flatMap((section) => section.items)
    : NAV_SPACES.filter((space) => space.roles.includes(role)).flatMap((space) =>
        visibleSections(space.id, role).flatMap((section) => section.items)
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
