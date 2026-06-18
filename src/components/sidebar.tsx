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
  Upload,
  PhoneCall,
  Megaphone,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: AppRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/llamadas", label: "Llamadas", icon: PhoneCall, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/leads", label: "Leads", icon: Users, roles: ["agente", "supervisor", "admin"] },
  { href: "/dashboard/team", label: "Mi equipo", icon: UsersRound, roles: ["supervisor"] },
  { href: "/dashboard/leads/cargar", label: "Cargar leads", icon: Upload, roles: ["supervisor", "admin"] },
  { href: "/dashboard/reportes", label: "Reportes", icon: BarChart3, roles: ["supervisor", "admin"] },
  { href: "/dashboard/admin/usuarios", label: "Usuarios", icon: ShieldCheck, roles: ["admin"] },
  { href: "/dashboard/admin/flujos", label: "Flujos", icon: Workflow, roles: ["admin"] },
  { href: "/dashboard/admin/campanas", label: "Campañas", icon: Megaphone, roles: ["admin"] },
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
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        Atlas CRM 2.0
      </div>
    </aside>
  );
}
