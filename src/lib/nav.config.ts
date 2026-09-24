import {
  Activity,
  BadgeCheck,
  BarChart3,
  Building2,
  Handshake,
  CalendarClock,
  CircleHelp,
  Database,
  Headphones,
  LayoutDashboard,
  Mail,
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
  HeartPulse,
  Package,
  Receipt,
  CalendarDays,
  Wallet,
  BellRing,
} from "lucide-react";
import type { AppModule } from "./modules";
import type { Edicion } from "@/lib/ediciones";
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

export type NavBadge = "live-agents" | "overdue-agenda" | "sales-to-validate";
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
  /**
   * Producto al que pertenece el ítem. Sin módulos declarados es transversal
   * (inicio, ayuda, administración de la plataforma). Con uno o más, la empresa
   * activa tiene que tener al menos uno contratado para verlo.
   */
  modules?: AppModule[];
  /**
   * Ediciones en las que el ítem existe. Sin lista es de todas. Una clínica
   * no navega por embudo sino por agenda: sus ítems (agenda, caja,
   * recordatorios) solo aparecen en Dental y Vet, y los del embudo (ventas,
   * registros) solo en Center. Sin edición conocida se comporta como Center.
   */
  ediciones?: Edicion[];
  badge?: NavBadge;
  /** Prefijos extra que mantienen el ítem activo (acciones y vistas hijas). */
  match?: string[];
  /** Pestañas del destino: se pintan en la página, nunca en el sidebar. */
  tabs?: NavTab[];
  /** También lo ve el dueño de la plataforma, aunque su rol no esté en `roles`. */
  duenio?: boolean;
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
          description: "Colas de voz, WhatsApp y correo, capacidad y excepciones; sin atender clientes",
          badge: "live-agents",
          match: ["/dashboard/operacion", "/dashboard/supervision/monitor"],
          tabs: [
            { label: "Centro de operaciones", href: "/dashboard/operacion" },
            { label: "Monitor en vivo", href: "/dashboard/supervision/monitor" },
          ],
          modules: ["contact_center"],
        },
        {
          id: "pacientes",
          label: "Pacientes",
          href: "/dashboard/pacientes",
          icon: HeartPulse,
          roles: ["admin", "supervisor"],
          description: "Fichas de pacientes o tutores: contacto, presupuestos, mascotas e historia",
          match: ["/dashboard/pacientes"],
          modules: ["ventas_b2c"],
        },
        {
          id: "agenda-clinica",
          label: "Agenda",
          href: "/dashboard/citas",
          icon: CalendarDays,
          roles: ["admin", "supervisor"],
          description: "Citas del día por profesional: confirmar, pasar a sala, atender",
          match: ["/dashboard/citas"],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "caja",
          label: "Caja",
          href: "/dashboard/caja",
          icon: Wallet,
          roles: ["admin", "supervisor"],
          description: "Por cobrar, presupuestos y lo cobrado en el mes",
          match: ["/dashboard/caja", "/dashboard/ventas"],
          tabs: [
            { label: "Por cobrar", href: "/dashboard/caja" },
            { label: "Presupuestos", href: "/dashboard/ventas" },
          ],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "campanas-clinica",
          label: "Campañas",
          href: "/dashboard/campanas-clinica",
          icon: Megaphone,
          roles: ["admin", "supervisor"],
          description: "Segmentos de la clínica, un mensaje y una fecha; resultados en la misma cola",
          match: ["/dashboard/campanas-clinica"],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "recordatorios",
          label: "Recordatorios",
          href: "/dashboard/recordatorios",
          icon: BellRing,
          roles: ["admin", "supervisor"],
          description: "A quién contactar hoy: citas sin confirmar, vacunas, presupuestos sin respuesta, pacientes que no vuelven",
          match: ["/dashboard/recordatorios"],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "ventas",
          label: "Ventas",
          href: "/dashboard/pipeline",
          icon: Handshake,
          roles: ["admin", "supervisor"],
          description: "Pipeline B2B: negocios por etapa, responsable, origen y próxima acción",
          match: ["/dashboard/pipeline", "/dashboard/ventas"],
          tabs: [
            { label: "Pipeline", href: "/dashboard/pipeline" },
            { label: "Lista", href: "/dashboard/ventas" },
            { label: "Resultados", href: "/dashboard/ventas/resultados" },
            { label: "Respuestas del agente", href: "/dashboard/ventas/respuestas" },
          ],
          modules: ["ventas_b2b", "ventas_b2c"],
          ediciones: ["center"],
        },
        {
          id: "correo",
          label: "Correo",
          href: "/dashboard/mail",
          icon: Mail,
          roles: OPERACION,
          description: "Cola de correo, asignación a ejecutivos y resultados por campaña",
          modules: ["correo"],
        },
        {
          id: "equipo",
          label: "Mi equipo",
          href: "/dashboard/team",
          icon: UsersRound,
          roles: ["supervisor"],
          description: "Carga, agendas y asignación de tus ejecutivos",
          modules: ["contact_center"],
        },
        {
          id: "usuarios-equipo",
          label: "Usuarios",
          href: "/dashboard/team/usuarios",
          icon: UserCog,
          roles: ["supervisor"],
          description: "Tus ejecutivos: campañas (skills), contraseña y acceso",
          modules: ["contact_center"],
        },
        {
          id: "campanas-operativas",
          label: "Campañas",
          href: "/dashboard/campanas",
          icon: Megaphone,
          roles: OPERACION,
          description: "Operación y canales habilitados por campaña",
          modules: ["contact_center"],
        },
        {
          id: "registros",
          label: { default: "Registros", agente: "Mis registros" },
          href: "/dashboard/leads",
          icon: Users,
          roles: ALL_ROLES,
          description: "Registros dentro de tu alcance; gestión solo para ejecutivos",
          match: ["/dashboard/leads", "/dashboard/llamadas"],
          modules: ["leads"],
          ediciones: ["center"],
        },
        {
          id: "conversaciones",
          label: { default: "Historial", agente: "Mi atención", admin: "Conversaciones" },
          href: "/dashboard/conversaciones",
          icon: MessageCircle,
          roles: ["agente", "supervisor"],
          // Administración no lee mensajes; el dueño de la plataforma sí, sin responder.
          duenio: true,
          description: "Atención asignada para ejecutivos; consulta de historial para supervisión",
          // El índice redirige al primer canal habilitado en la campaña, así
          // que el ítem tiene que seguir activo en /voz, /whatsapp y /correo.
          match: ["/dashboard/conversaciones"],
          modules: ["contact_center", "whatsapp", "correo"],
          ediciones: ["center"],
        },
        {
          id: "conversaciones-clinica",
          label: "Conversaciones",
          href: "/dashboard/mensajes",
          icon: MessageCircle,
          roles: ["admin", "supervisor"],
          description: "El WhatsApp de la clínica: lo que Atlas envió y lo que respondieron, en el mismo hilo",
          match: ["/dashboard/mensajes"],
          modules: ["whatsapp"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "agenda",
          label: "Mi agenda",
          href: "/dashboard/agenda",
          icon: CalendarClock,
          roles: ["agente"],
          description: "Seguimientos de hoy y vencidos",
          badge: "overdue-agenda",
          modules: ["leads"],
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
          modules: ["contact_center"],
        },
        {
          id: "reportes-clinica",
          label: "Reportes",
          href: "/dashboard/reportes-clinica",
          icon: BarChart3,
          roles: ["admin", "supervisor"],
          description: "Tableros de la clínica: producción, profesionales, agenda, presupuestos, pacientes y caja, con descarga a Excel",
          match: ["/dashboard/reportes-clinica"],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "validacion-ventas",
          label: "Validación de ventas",
          href: "/dashboard/validacion-ventas",
          icon: BadgeCheck,
          roles: OPERACION,
          description: "Ventas tipificadas por los ejecutivos: aprobarlas para que avancen en el CRM o rechazarlas con motivo",
          badge: "sales-to-validate",
          modules: ["contact_center"],
          ediciones: ["center"],
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
          modules: ["contact_center"],
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
    { id: "control-operation", label: "Control diario", itemIds: ["operacion", "agenda-clinica", "pacientes", "caja", "recordatorios", "campanas-clinica", "ventas", "correo", "registros"] },
    { id: "control-results", label: "Revisión", itemIds: ["validacion-ventas", "conversaciones", "conversaciones-clinica", "reportes", "reportes-clinica", "calidad"] },
    { id: "admin-operation", label: "Configuración", itemIds: ["aranceles", "insumos", "correo-clinica", "campanas", "colas", "flujos", "estados-agente", "cargas"] },
    { id: "admin-platform", label: "Plataforma", itemIds: ["empresas", "usuarios", "extensiones", "integraciones"] },
  ],
  supervisor: [
    { id: "supervision-home", itemIds: ["inicio"] },
    { id: "supervision-operation", label: "Supervisión", itemIds: ["operacion", "agenda-clinica", "pacientes", "caja", "recordatorios", "campanas-clinica", "ventas", "correo", "equipo", "usuarios-equipo", "campanas-operativas", "registros"] },
    { id: "supervision-review", label: "Revisión y resultados", itemIds: ["validacion-ventas", "conversaciones", "conversaciones-clinica", "calidad", "reportes", "reportes-clinica"] },
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
          modules: ["contact_center"],
        },
        {
          id: "colas",
          label: "Colas y enrutamiento",
          href: "/dashboard/admin/colas",
          icon: Network,
          roles: ["admin"],
          description: "Distribución omnicanal, capacidad, SLA y miembros",
          modules: ["contact_center"],
        },
        {
          id: "flujos",
          label: "Flujos de gestión",
          href: "/dashboard/admin/flujos",
          icon: Workflow,
          roles: ["admin"],
          description: "Guiones, pasos y tipificaciones",
          modules: ["contact_center"],
        },
        {
          id: "estados-agente",
          label: "Estados de agente",
          href: "/dashboard/admin/estados-agente",
          icon: UserCog,
          roles: ["admin"],
          description: "Catálogo de estados del discador",
          modules: ["contact_center"],
        },
        {
          id: "aranceles",
          label: "Procedimientos y precios",
          href: "/dashboard/admin/aranceles",
          icon: Receipt,
          roles: ["admin"],
          description: "Arancel de la clínica: procedimientos, urgencias, precios y duración",
          modules: ["ventas_b2c"],
        },
        {
          id: "correo-clinica",
          label: "Correo de la clínica",
          href: "/dashboard/admin/correo",
          icon: Mail,
          roles: ["admin"],
          description: "El buzón desde el que la clínica lee y responde correos",
          match: ["/dashboard/admin/correo"],
          modules: ["ventas_b2c"],
          ediciones: ["dental", "vet"],
        },
        {
          id: "insumos",
          label: "Materiales e insumos",
          href: "/dashboard/admin/insumos",
          icon: Package,
          roles: ["admin"],
          description: "Materiales de la clínica: costo, precio, stock y consumo",
          modules: ["ventas_b2c"],
        },
        {
          id: "cargas",
          label: "Cargas y listas",
          href: "/dashboard/admin/cargas",
          icon: Database,
          roles: ["admin"],
          description: "Importación de bases y su historial",
          modules: ["leads"],
        },
      ],
    },
    {
      id: "admin-plataforma",
      label: "Plataforma",
      items: [
        {
          id: "empresas",
          label: "Empresas",
          href: "/dashboard/admin/empresas",
          icon: Building2,
          roles: ["admin"],
          description: "Empresas del CRM, sus personas y su aislamiento",
        },
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
          modules: ["contact_center"],
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
          modules: ["contact_center", "whatsapp"],
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

/**
 * ¿Este ítem corresponde a la empresa que se está mirando?
 *
 * `undefined` significa "todavía no sé qué tiene contratado": se muestra todo,
 * porque esconder el menú mientras carga es peor que mostrarlo de más, y el
 * servidor igual cierra la página que no corresponde.
 */
function enLosModulos(item: NavItem, modules?: AppModule[]): boolean {
  if (!modules || !item.modules) return true;
  return item.modules.some((modulo) => modules.includes(modulo));
}

/** Sin edición conocida el menú se comporta como Center, que es como era todo antes de esto. */
function enLaEdicion(item: NavItem, edicion?: Edicion): boolean {
  if (!item.ediciones) return true;
  return item.ediciones.includes(edicion ?? "center");
}

/** Secciones visibles de un espacio para un rol, ya filtradas y sin secciones vacías. */
export function visibleSections(
  spaceId: NavSpaceId,
  role: AppRole,
  modules?: AppModule[],
  duenio = false,
  edicion?: Edicion,
): NavSection[] {
  const permitido = (item: NavItem) => item.roles.includes(role) || (duenio && item.duenio === true);
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
          return item && permitido(item) && enLosModulos(item, modules) && enLaEdicion(item, edicion) ? [item] : [];
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
        return item && permitido(item) && enLosModulos(item, modules) && enLaEdicion(item, edicion) ? [item] : [];
      }),
    })).filter((section) => section.items.length > 0);
  }
  return space
    .sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => permitido(item) && enLosModulos(item, modules) && enLaEdicion(item, edicion)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Todos los ítems accesibles por un rol, en orden de menú (usado por la búsqueda global). */
export function allItemsForRole(role: AppRole, modules?: AppModule[], edicion?: Edicion): NavItem[] {
  const items = role === "admin"
    ? visibleSections("console", role, modules, false, edicion).flatMap((section) => section.items)
    : NAV_SPACES.filter((space) => space.roles.includes(role)).flatMap((space) =>
        visibleSections(space.id, role, modules, false, edicion).flatMap((section) => section.items)
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
export function tabsForPath(pathname: string, role: AppRole, modules?: AppModule[], edicion?: Edicion): NavTab[] {
  const item = allItemsForRole(role, modules, edicion).find((candidate) => candidate.tabs && isItemActive(candidate, pathname));
  return (item?.tabs ?? []).filter((tab) => !tab.roles || tab.roles.includes(role));
}

const ID_EN_RUTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Dónde dejar a la persona después de cambiar de empresa?
 *
 * La misma URL no siempre sigue existiendo: si la nueva empresa no contrató la
 * aplicación, su layout responde 404 (a propósito, ver `requireModule`). Y una
 * ficha (/ventas/<id>) es de la empresa anterior, así que en la nueva tampoco
 * está. Se queda en la misma aplicación cuando se puede; si no, vuelve al inicio.
 */
export function destinoTrasCambiarEmpresa(pathname: string, modules: AppModule[]): string {
  const segmentos = pathname.split("/").filter(Boolean);
  const corte = segmentos.findIndex((segmento) => ID_EN_RUTA.test(segmento));
  const ruta = corte === -1 ? pathname : "/" + segmentos.slice(0, corte).join("/");

  const items = [...NAV_SPACES.flatMap((space) => space.sections.flatMap((section) => section.items)), HELP_ITEM];
  // La ruta la gobierna el ítem cuyo href la contiene. `match` solo sirve para
  // resaltar el menú: Caja se resalta en /ventas, pero /ventas sigue exigiendo
  // los módulos de Ventas, no los de Caja. Cuando ningún href la cubre (una
  // vista hija como /llamadas), vale el `match`.
  const cubre = (href: string) => ruta === href || ruta.startsWith(`${href}/`);
  const contiene = (item: NavItem) => cubre(item.href) || (item.tabs ?? []).some((tab) => cubre(tab.href));
  const porHref = items.filter((item) => item.modules && contiene(item));
  const duenios = porHref.length > 0 ? porHref : items.filter((item) => item.modules && isItemActive(item, ruta));
  const exigen = duenios.map((item) => item.modules as AppModule[]);
  // Basta con que uno de los ítems que llevan a la ruta esté disponible: la
  // misma pantalla puede ser pestaña de Ventas en Center y de Caja en una clínica.
  const disponible = exigen.length === 0 || exigen.some((requeridos) => requeridos.some((modulo) => modules.includes(modulo)));
  return disponible ? ruta : "/dashboard";
}
