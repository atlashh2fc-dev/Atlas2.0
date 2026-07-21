"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole, Profile } from "@/lib/types";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  ShieldCheck,
  BarChart3,
  LineChart,
  Workflow,
  Megaphone,
  History,
  CalendarClock,
  Upload,
  UserPlus,
  PhoneCall,
  MailCheck,
  UserCog,
  Activity,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: AppRole[];
  /** Etiqueta de sección que se muestra justo antes de este ítem (agrupa visualmente sin sub-menú). */
  sectionLabel?: string;
  /** Ítem secundario dentro de un grupo (p. ej. "Flujos" bajo "Campañas"): se muestra indentado y más sutil. */
  indent?: boolean;
  /** Subcategoría silenciosa dentro de una sección, para no exponer integraciones como módulos principales. */
  subsectionLabel?: string;
}

type NavGroup = { label: string; items: NavItem[] };

/** Agrupa los ítems visibles por su `sectionLabel` (cada label inicia un grupo). */
function buildGroups(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    if (item.sectionLabel || groups.length === 0) {
      groups.push({ label: item.sectionLabel ?? "General", items: [item] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }
  return groups;
}

const NAV_ITEMS: NavItem[] = [
  // Espacio de trabajo: lo que se usa a diario.
  {
    href: "/dashboard",
    label: "Inicio",
    icon: LayoutDashboard,
    roles: ["agente", "supervisor", "admin"],
    sectionLabel: "Espacio de trabajo",
  },
  { href: "/dashboard/leads", label: "Registros", icon: Users, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/agenda", label: "Mi agenda", icon: CalendarClock, roles: ["agente"] },

  // Operación: monitoreo y control del trabajo en curso.
  {
    href: "/dashboard/team",
    label: "Mi equipo",
    icon: UsersRound,
    roles: ["supervisor"],
    sectionLabel: "Operación",
  },
  {
    href: "/dashboard/supervision/monitor",
    label: "Monitor en vivo",
    icon: Activity,
    roles: ["supervisor", "admin"],
  },
  {
    href: "/dashboard/supervision/reportes",
    label: "Reportes de discador",
    icon: LineChart,
    roles: ["supervisor", "admin"],
  },
  { href: "/dashboard/reportes", label: "Reportes de gestión", icon: BarChart3, roles: ["supervisor", "admin"] },

  // Campañas: la configuración funcional de cada operación.
  {
    href: "/dashboard/admin/campanas",
    label: "Campañas",
    icon: Megaphone,
    roles: ["admin"],
    sectionLabel: "Campañas",
  },
  { href: "/dashboard/admin/flujos", label: "Flujos de gestión", icon: Workflow, roles: ["admin"], indent: true },

  // Datos: carga y administración de las bases operativas.
  {
    href: "/dashboard/leads/nuevo",
    label: "Nuevo registro",
    icon: UserPlus,
    roles: ["supervisor", "admin"],
    sectionLabel: "Datos",
  },
  {
    href: "/dashboard/leads/cargar",
    label: "Cargar leads",
    icon: Upload,
    roles: ["admin"],
  },
  { href: "/dashboard/mail", label: "Leads mail", icon: MailCheck, roles: ["supervisor", "admin"] },

  // Configuración: ajustes transversales de la plataforma y del discador.
  {
    href: "/dashboard/admin/usuarios",
    label: "Usuarios y equipos",
    icon: ShieldCheck,
    roles: ["admin"],
    sectionLabel: "Configuración",
  },
  {
    href: "/dashboard/admin/estados-agente",
    label: "Estados de agente",
    icon: UserCog,
    roles: ["admin"],
    indent: true,
    subsectionLabel: "Discador",
  },
  { href: "/dashboard/admin/agentes-sip", label: "Extensiones SIP", icon: PhoneCall, roles: ["admin"], indent: true },

  // Integraciones: capacidades que pertenecen a un proveedor, no al CRM base.
  {
    href: "/dashboard/admin/vocalcom",
    label: "Importar gestión Vocalcom",
    icon: Upload,
    roles: ["admin"],
    sectionLabel: "Integraciones",
    subsectionLabel: "Equifax",
  },
  {
    href: "/dashboard/admin/ejecutivos-historicos",
    label: "Historial de ejecutivos",
    icon: History,
    roles: ["admin"],
    indent: true,
  },

  // Ayuda: guía contextual para quienes configuran y supervisan la operación.
  {
    href: "/dashboard/ayuda",
    label: "Ayuda",
    icon: CircleHelp,
    roles: ["agente", "supervisor", "admin"],
    sectionLabel: "Soporte",
  },
];

const ROLE_LABEL: Record<AppRole, string> = {
  agente: "Agente",
  supervisor: "Supervisor",
  admin: "Administrador",
};

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const groups = buildGroups(NAV_ITEMS.filter((item) => item.roles.includes(profile.role)));

  const [rail, setRail] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>(["Integraciones"]);
  const toggleGroup = (label: string) =>
    setCollapsed((c) => (c.includes(label) ? c.filter((l) => l !== label) : [...c, label]));

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  return (
    <aside
      className={`hidden flex-shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex ${
        rail ? "w-16" : "w-64"
      }`}
    >
      <div className={`flex h-16 items-center gap-2 border-b border-border ${rail ? "justify-center px-2" : "px-4"}`}>
        <Image
          src="/atlas-logo.png"
          alt="Atlas"
          width={32}
          height={32}
          className="size-8 flex-shrink-0 rounded-full object-contain shadow-sm"
          priority
        />
        {!rail && (
          <>
            <div className="leading-none">
              <span className="text-sm font-semibold text-foreground">Atlas</span>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Consola · {ROLE_LABEL[profile.role]}</p>
            </div>
            <button
              type="button"
              onClick={() => setRail(true)}
              aria-label="Colapsar menú"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <PanelLeftClose size={17} />
            </button>
          </>
        )}
      </div>

      {rail && (
        <button
          type="button"
          onClick={() => setRail(false)}
          aria-label="Expandir menú"
          className="mx-2 mt-2 flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        {groups.map((group) => {
          const hasActiveItem = group.items.some((item) => isActive(item.href));
          const isCollapsed = collapsed.includes(group.label) && !hasActiveItem;
          return (
            <div key={group.label} className="mb-1">
              {rail ? (
                <div className="mx-2 my-1.5 border-t border-border/60" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex w-full items-center gap-1.5 px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    size={13}
                    className={`ml-auto transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              )}

              {!isCollapsed &&
                group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <div key={item.href}>
                      {!rail && item.subsectionLabel && (
                        <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                          {item.subsectionLabel}
                        </p>
                      )}
                      <Link
                        href={item.href}
                        title={rail ? item.label : undefined}
                        className={`group flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                          rail ? "justify-center px-2 py-2" : item.indent ? "py-2 pl-7 pr-3 text-[13px]" : "px-3 py-2"
                        } ${
                          active
                            ? "bg-foreground/[0.08] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_/_8%,transparent)]"
                            : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
                            active ? "bg-primary/12 text-primary" : "text-muted-foreground/80 group-hover:text-foreground"
                          }`}
                        >
                          <Icon size={16} />
                        </span>
                        {!rail && item.label}
                      </Link>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <div className={`flex items-center gap-2.5 border-t border-border p-3 ${rail ? "justify-center" : ""}`}>
        <div className="relative flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(profile.full_name)}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-surface" />
        </div>
        {!rail && (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">{profile.full_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABEL[profile.role]}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
