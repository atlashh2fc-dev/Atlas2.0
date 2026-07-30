"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole, Profile } from "@/lib/types";
import {
  HELP_HREF,
  ROLE_LABEL,
  isItemActive,
  navLabel,
  spaceForPath,
  visibleSections,
  type NavBadge,
  type NavItem,
  type NavSection,
} from "@/lib/nav.config";
import {
  ArrowLeft,
  ChevronDown,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";

const COLLAPSED_KEY = "atlas.nav.collapsed";

export type NavBadgeCounts = Partial<Record<NavBadge, number>>;

/**
 * Preferencia de secciones colapsadas, persistida por usuario y compartida
 * entre el sidebar y el drawer móvil. Nada viene colapsado por defecto.
 */
const NONE: string[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: string[] } = { raw: null, value: NONE };

function readCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (raw !== cache.raw) cache = { raw, value: raw ? (JSON.parse(raw) as string[]) : NONE };
    return cache.value;
  } catch {
    return NONE;
  }
}

function subscribeCollapsed(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writeCollapsed(next: string[]) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
  } catch {
    /* la preferencia es opcional: no bloquear la navegación si el storage falla */
  }
  listeners.forEach((listener) => listener());
}

function useCollapsedSections(): [string[], (id: string) => void] {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => NONE);
  const toggle = (id: string) =>
    writeCollapsed(collapsed.includes(id) ? collapsed.filter((value) => value !== id) : [...collapsed, id]);
  return [collapsed, toggle];
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Un encabezado de sección solo se paga desde 3 ítems (docs/arquitectura-navegacion.md §4.5). */
function showsHeader(section: NavSection): boolean {
  return Boolean(section.label) && section.items.length >= 3;
}

function NavLink({
  item,
  role,
  active,
  rail,
  badge,
  onNavigate,
}: {
  item: NavItem;
  role: AppRole;
  active: boolean;
  rail: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const label = navLabel(item, role);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${
        rail ? "justify-center px-2 py-2" : "px-3 py-2"
      } ${
        active
          ? "bg-foreground/[0.08] text-foreground"
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

      {!rail && <span className="truncate">{label}</span>}

      {!rail && badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {badge}
        </span>
      )}

      {rail && (
        <>
          {badge !== undefined && badge > 0 && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
          >
            {label}
          </span>
        </>
      )}
    </Link>
  );
}

/** Árbol de navegación compartido por el sidebar de escritorio y el drawer móvil. */
export function NavTree({
  profile,
  pathname,
  rail = false,
  badges,
  onNavigate,
}: {
  profile: Profile;
  pathname: string;
  rail?: boolean;
  badges?: NavBadgeCounts;
  onNavigate?: () => void;
}) {
  const space = spaceForPath(pathname);
  const sections = visibleSections(space, profile.role);

  const [collapsed, toggleSection] = useCollapsedSections();

  return (
    <>
      {sections.map((section) => {
        const withHeader = showsHeader(section) && !rail;
        const hasActive = section.items.some((item) => isItemActive(item, pathname));
        const isCollapsed = withHeader && collapsed.includes(section.id) && !hasActive;

        return (
          <div key={section.id} className="mb-1">
            {withHeader && (
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              >
                <span>{section.label}</span>
                <ChevronDown size={13} className={`ml-auto transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </button>
            )}

            {!isCollapsed && (
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.id}
                    item={item}
                    role={profile.role}
                    active={isItemActive(item, pathname)}
                    rail={rail}
                    badge={item.badge ? badges?.[item.badge] : undefined}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Pie del menú: cambio de espacio, ayuda y perfil. Idéntico en escritorio y móvil. */
export function NavFooter({
  profile,
  pathname,
  rail = false,
  onNavigate,
}: {
  profile: Profile;
  pathname: string;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const inAdmin = spaceForPath(pathname) === "admin";
  const helpActive = pathname.startsWith(HELP_HREF);

  return (
    <div className="border-t border-border p-2">
      {profile.role === "admin" && !inAdmin && (
        <Link
          href="/dashboard/admin/campanas"
          onClick={onNavigate}
          title={rail ? "Administración" : undefined}
          className={`group relative flex items-center gap-3 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground ${
            rail ? "justify-center px-2 py-2" : "px-3 py-2"
          }`}
        >
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground/80 group-hover:text-foreground">
            <Settings size={16} />
          </span>
          {!rail && "Administración"}
        </Link>
      )}

      <Link
        href={HELP_HREF}
        onClick={onNavigate}
        title={rail ? "Ayuda" : undefined}
        aria-current={helpActive ? "page" : undefined}
        className={`group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
          rail ? "justify-center px-2 py-2" : "px-3 py-2"
        } ${
          helpActive
            ? "bg-foreground/[0.08] text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
        }`}
      >
        <span
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
            helpActive ? "bg-primary/12 text-primary" : "text-muted-foreground/80 group-hover:text-foreground"
          }`}
        >
          <CircleHelp size={16} />
        </span>
        {!rail && "Ayuda"}
      </Link>

      <div className={`mt-1 flex items-center gap-2.5 border-t border-border pt-3 ${rail ? "justify-center" : "px-1"}`}>
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
    </div>
  );
}

export function Sidebar({ profile, badges }: { profile: Profile; badges?: NavBadgeCounts }) {
  const pathname = usePathname();
  const inAdmin = spaceForPath(pathname) === "admin";
  const [rail, setRail] = useState(false);

  return (
    <aside
      aria-label="Navegación principal"
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
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {inAdmin ? "Administración" : `Consola · ${ROLE_LABEL[profile.role]}`}
              </p>
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

      {inAdmin && (
        <Link
          href="/dashboard"
          title={rail ? "Volver a la Consola" : undefined}
          className={`group mx-2 mt-2 flex items-center gap-2 rounded-lg py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground ${
            rail ? "justify-center px-2" : "px-3"
          }`}
        >
          <ArrowLeft size={16} className="flex-shrink-0" />
          {!rail && "Volver a la Consola"}
        </Link>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        <NavTree profile={profile} pathname={pathname} rail={rail} badges={badges} />
      </nav>

      <NavFooter profile={profile} pathname={pathname} rail={rail} />
    </aside>
  );
}
