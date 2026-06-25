"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/types";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  ShieldCheck,
  BarChart3,
  Workflow,
  Megaphone,
  History,
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
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/leads", label: "Leads", icon: Users, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/team", label: "Mi equipo", icon: UsersRound, roles: ["supervisor"] },
  { href: "/dashboard/reportes", label: "Reportes", icon: BarChart3, roles: ["supervisor", "admin"] },
  { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: ShieldCheck, roles: ["admin"] },
  {
    href: "/dashboard/admin/ejecutivos-historicos",
    label: "Ejecutivos históricos",
    icon: History,
    roles: ["admin"],
  },
  {
    href: "/dashboard/admin/campanas",
    label: "Campañas",
    icon: Megaphone,
    roles: ["admin"],
    sectionLabel: "Gestión de campañas",
  },
  { href: "/dashboard/admin/flujos", label: "Flujos", icon: Workflow, roles: ["admin"], indent: true },
];

export function Sidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          A
        </div>
        <span className="text-base font-semibold text-foreground">Atlas</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
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
                className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                  item.indent ? "ml-3 py-1.5 pl-3 pr-3 text-[13px]" : "px-3 py-2"
                } ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                <Icon size={item.indent ? 16 : 18} />
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        Atlas CRM 2.0
      </div>
    </aside>
  );
}
