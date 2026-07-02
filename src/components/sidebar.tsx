"use client";

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
  Workflow,
  Megaphone,
  History,
  CalendarClock,
  Upload,
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
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Inicio",
    icon: LayoutDashboard,
    roles: ["agente", "supervisor", "admin"],
    sectionLabel: "Operación",
  },
  { href: "/dashboard/leads", label: "Cola", icon: Users, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/agenda", label: "Mi agenda", icon: CalendarClock, roles: ["agente", "admin"] },
  {
    href: "/dashboard/team",
    label: "Mi equipo",
    icon: UsersRound,
    roles: ["supervisor"],
    sectionLabel: "Supervisión",
  },
  { href: "/dashboard/reportes", label: "Reportes", icon: BarChart3, roles: ["supervisor", "admin"] },
  {
    href: "/dashboard/leads/cargar",
    label: "Cargar leads",
    icon: Upload,
    roles: ["supervisor", "admin"],
    sectionLabel: "Datos",
  },
  {
    href: "/dashboard/admin/ejecutivos-historicos",
    label: "Ejecutivos históricos",
    icon: History,
    roles: ["admin"],
  },
  {
    href: "/dashboard/admin/usuarios",
    label: "Usuarios",
    icon: ShieldCheck,
    roles: ["admin"],
    sectionLabel: "Administración",
  },
  {
    href: "/dashboard/admin/campanas",
    label: "Campañas",
    icon: Megaphone,
    roles: ["admin"],
    sectionLabel: "Campañas",
  },
  { href: "/dashboard/admin/flujos", label: "Flujos", icon: Workflow, roles: ["admin"], indent: true },
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
  const items = NAV_ITEMS.filter((item) => item.roles.includes(profile.role));

  return (
    <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <Image
          src="/atlas-logo.png"
          alt="Atlas"
          width={36}
          height={36}
          className="size-9 rounded-full object-contain shadow-sm"
          priority
        />
        <span className="text-base font-semibold text-foreground">Atlas</span>
        <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          2.0
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
          const Icon = item.icon;
          return (
            <div key={item.href}>
              {item.sectionLabel && (
                <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 first:mt-1">
                  {item.sectionLabel}
                </p>
              )}
              <Link
                href={item.href}
                className={`group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                  item.indent ? "ml-3 py-1.5 pl-3 pr-3 text-[13px]" : "px-3 py-2"
                } ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {active && !item.indent && (
                  <span className="absolute -left-3 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <span
                  className={`flex items-center justify-center rounded-md transition-colors ${
                    item.indent
                      ? ""
                      : `h-7 w-7 ${active ? "bg-primary/15 text-primary" : "text-muted-foreground group-hover:text-foreground"}`
                  }`}
                >
                  <Icon size={item.indent ? 16 : 16} />
                </span>
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-border p-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {initials(profile.full_name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{profile.full_name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABEL[profile.role]}</p>
        </div>
      </div>
    </aside>
  );
}
