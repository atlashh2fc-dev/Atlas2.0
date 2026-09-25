"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MarcaAtlas } from "@/components/marca-atlas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION, type Edicion } from "@/lib/ediciones";
import type { AppModule } from "@/lib/modules";
import type { AppRole, Profile } from "@/lib/types";
import { useViewPreference } from "@/lib/use-view-preference";
import {
  HELP_HREF,
  ROLE_LABEL,
  isItemActive,
  navLabel,
  setupEntryHref,
  spaceForPath,
  visibleSections,
  workspaceLabel,
  type NavBadge,
  type NavItem,
  type NavSection,
  type NavSpaceId,
} from "@/lib/nav.config";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  CircleHelp,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Star,
} from "lucide-react";

export type NavBadgeCounts = Partial<Record<NavBadge, number>>;

/**
 * Menú de cada persona, guardado en su cuenta (como la barra editable de
 * Salesforce o los favoritos de HubSpot): lo que fijó arriba y en qué orden,
 * lo que sacó de la vista y qué secciones dejó plegadas. El menú por perfil
 * sigue mandando; esto solo reordena y esconde dentro de lo permitido, y la
 * búsqueda encuentra igual lo que esté oculto.
 */
export type NavPreference = {
  favorites: string[];
  hidden: string[];
  collapsed: string[];
};

const DEFAULT_NAV_PREFERENCE: NavPreference = { favorites: [], hidden: [], collapsed: [] };

export type NavPersonalization = {
  preference: NavPreference;
  toggleFavorite: (id: string) => void;
  moveFavorite: (id: string, direction: -1 | 1) => void;
  toggleHidden: (id: string) => void;
  toggleCollapsed: (id: string) => void;
  reset: () => void;
};

export function useNavPersonalization(profile: Profile): NavPersonalization {
  const [stored, setStored] = useViewPreference<NavPreference>(
    "sidebar",
    DEFAULT_NAV_PREFERENCE,
    `${profile.id}:${profile.role}`,
  );
  // Una preferencia vieja o a medio escribir no puede romper el menú.
  const preference = useMemo<NavPreference>(() => {
    const list = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return {
      favorites: list(stored?.favorites),
      hidden: list(stored?.hidden),
      collapsed: list(stored?.collapsed),
    };
  }, [stored]);

  const toggleIn = useCallback(
    (key: keyof NavPreference, id: string) => {
      const current = preference[key];
      setStored({
        ...preference,
        [key]: current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      });
    },
    [preference, setStored],
  );

  const moveFavorite = useCallback(
    (id: string, direction: -1 | 1) => {
      const favorites = [...preference.favorites];
      const from = favorites.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= favorites.length) return;
      [favorites[from], favorites[to]] = [favorites[to], favorites[from]];
      setStored({ ...preference, favorites });
    },
    [preference, setStored],
  );

  return {
    preference,
    toggleFavorite: (id) => toggleIn("favorites", id),
    moveFavorite,
    toggleHidden: (id) => toggleIn("hidden", id),
    toggleCollapsed: (id) => toggleIn("collapsed", id),
    reset: () => setStored(DEFAULT_NAV_PREFERENCE),
  };
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Dos destinos analíticos ya forman un grupo útil en la consola omnicanal. */
function showsHeader(section: NavSection): boolean {
  return Boolean(section.label) && section.items.length >= 2;
}

/** En Dental y Vet algunos destinos se llaman como lo que la clínica hace. */
function relabelForEdicion(item: NavItem, edicion: Edicion): NavItem {
  if (edicion === "center") return item;
  if (item.id === "inicio") return { ...item, label: "Hoy", description: "La agenda de hoy, lo que hay que cobrar y a quién llamar" };
  if (item.id === "ventas") {
    const ventas = VENTAS_POR_EDICION[edicion];
    return { ...item, label: ventas.titulo, description: ventas.descripcion };
  }
  if (item.id === "pacientes") {
    const pacientes = PACIENTES_POR_EDICION[edicion];
    return { ...item, label: pacientes.titulo, description: pacientes.descripcion };
  }
  return item;
}

function sectionsFor(
  space: NavSpaceId,
  profile: Profile,
  modules: AppModule[] | undefined,
  duenio: boolean,
  edicion: Edicion,
): NavSection[] {
  return visibleSections(space, profile.role, modules, duenio, edicion).map((section) => ({
    ...section,
    items: section.items.map((item) => relabelForEdicion(item, edicion)),
  }));
}

const ITEM_ACTION =
  "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NavLink({
  item,
  role,
  active,
  rail,
  badge,
  onNavigate,
  personalization,
  editing = false,
  favoriteControls,
}: {
  item: NavItem;
  role: AppRole;
  active: boolean;
  rail: boolean;
  badge?: number;
  onNavigate?: () => void;
  personalization?: NavPersonalization;
  editing?: boolean;
  /** Solo en la sección Favoritos: subir y bajar. */
  favoriteControls?: { first: boolean; last: boolean };
}) {
  const Icon = item.icon;
  const label = navLabel(item, role);
  const favorite = personalization?.preference.favorites.includes(item.id) ?? false;
  const hidden = personalization?.preference.hidden.includes(item.id) ?? false;
  const showActions = Boolean(personalization) && !rail;

  return (
    <div className={`group relative ${editing && hidden ? "opacity-45" : ""}`}>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-label={rail ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${
          rail ? "justify-center px-2 py-2" : "px-3 py-2"
        } ${showActions ? (editing ? "pr-20" : "group-hover:pr-9") : ""} ${
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

        {!rail && !editing && badge !== undefined && badge > 0 && (
          <span className="ml-auto rounded-full bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary group-hover:hidden">
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
              className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {label}
            </span>
          </>
        )}
      </Link>

      {showActions && personalization && (
        <div
          className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 ${
            editing ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          {editing && favoriteControls && (
            <>
              <button
                type="button"
                className={ITEM_ACTION}
                disabled={favoriteControls.first}
                onClick={() => personalization.moveFavorite(item.id, -1)}
                aria-label={`Subir ${label} en favoritos`}
                title="Subir"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className={ITEM_ACTION}
                disabled={favoriteControls.last}
                onClick={() => personalization.moveFavorite(item.id, 1)}
                aria-label={`Bajar ${label} en favoritos`}
                title="Bajar"
              >
                <ArrowDown size={13} />
              </button>
            </>
          )}
          {editing && !favoriteControls && (
            <button
              type="button"
              className={ITEM_ACTION}
              onClick={() => personalization.toggleHidden(item.id)}
              aria-pressed={hidden}
              aria-label={hidden ? `Mostrar ${label} en el menú` : `Ocultar ${label} del menú`}
              title={hidden ? "Mostrar en el menú" : "Ocultar del menú"}
            >
              {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <button
            type="button"
            className={`${ITEM_ACTION} ${favorite ? "text-warning hover:text-warning" : ""}`}
            onClick={() => personalization.toggleFavorite(item.id)}
            aria-pressed={favorite}
            aria-label={favorite ? `Quitar ${label} de favoritos` : `Fijar ${label} en favoritos`}
            title={favorite ? "Quitar de favoritos" : "Fijar en favoritos"}
          >
            <Star size={13} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Árbol de navegación compartido por el sidebar de escritorio y el drawer móvil. */
export function NavTree({
  profile,
  pathname,
  rail = false,
  badges,
  modules,
  edicion = "center",
  duenio = false,
  onNavigate,
  personalization,
  editing = false,
}: {
  profile: Profile;
  pathname: string;
  rail?: boolean;
  badges?: NavBadgeCounts;
  /** Módulos contratados por la empresa activa; el menú se arma con esto. */
  modules?: AppModule[];
  /** En Dental y Vet, "Ventas" se llama como lo que venden: presupuestos o planes. */
  edicion?: Edicion;
  /** El dueño de la plataforma ve además lo marcado `duenio` (Conversaciones). */
  duenio?: boolean;
  onNavigate?: () => void;
  personalization?: NavPersonalization;
  /** Modo «Personalizar menú»: muestra todo, con controles de ocultar y ordenar. */
  editing?: boolean;
}) {
  const space = spaceForPath(pathname, profile.role);
  const sections = sectionsFor(space, profile, modules, duenio, edicion);
  const preference = personalization?.preference ?? DEFAULT_NAV_PREFERENCE;

  // Favoritos pueden venir de cualquier espacio: un admin que entra a Colas
  // todos los días la fija arriba de su operación.
  const reachable = new Map(
    (["console", "admin"] as const)
      .flatMap((candidate) => sectionsFor(candidate, profile, modules, duenio, edicion))
      .flatMap((section) => section.items)
      .map((item) => [item.id, item]),
  );
  const favorites = space === "console"
    ? preference.favorites.flatMap((id) => {
        const item = reachable.get(id);
        return item ? [item] : [];
      })
    : [];

  const renderItem = (item: NavItem, favoriteControls?: { first: boolean; last: boolean }) => (
    <NavLink
      key={item.id}
      item={item}
      role={profile.role}
      active={isItemActive(item, pathname)}
      rail={rail}
      badge={item.badge ? badges?.[item.badge] : undefined}
      onNavigate={onNavigate}
      personalization={personalization}
      editing={editing}
      favoriteControls={favoriteControls}
    />
  );

  return (
    <>
      {space === "admin" && (
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label={rail ? "Volver a la operación" : undefined}
          title={rail ? "Volver a la operación" : undefined}
          className={`mb-2 flex items-center gap-2 rounded-lg border border-border text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground ${
            rail ? "justify-center px-2 py-2" : "px-3 py-2"
          }`}
        >
          <ArrowLeft size={14} />
          {!rail && "Volver a la operación"}
        </Link>
      )}

      {favorites.length > 0 && (
        <div className="mb-1">
          {!rail && (
            <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Star size={11} fill="currentColor" className="text-warning" /> Favoritos
            </p>
          )}
          <div className="space-y-0.5">
            {favorites.map((item, index) =>
              renderItem(item, { first: index === 0, last: index === favorites.length - 1 }),
            )}
          </div>
          <div className="mx-3 my-2 border-t border-border" />
        </div>
      )}

      {sections.map((section) => {
        // Lo oculto desaparece, salvo la página abierta: nadie pierde de vista
        // dónde está. En modo personalizar se ve todo para poder reponerlo.
        const items = editing
          ? section.items
          : section.items.filter((item) => !preference.hidden.includes(item.id) || isItemActive(item, pathname));
        if (items.length === 0) return null;
        const withHeader = showsHeader({ ...section, items }) && !rail;
        const hasActive = items.some((item) => isItemActive(item, pathname));
        const isCollapsed = withHeader && !editing && preference.collapsed.includes(section.id) && !hasActive;

        return (
          <div key={section.id} className="mb-1">
            {withHeader && (
              <button
                type="button"
                onClick={() => personalization?.toggleCollapsed(section.id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              >
                <span>{section.label}</span>
                <ChevronDown size={13} className={`ml-auto transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
              </button>
            )}

            {!isCollapsed && <div className="space-y-0.5">{items.map((item) => renderItem(item))}</div>}
          </div>
        );
      })}
    </>
  );
}

const FOOTER_LINK =
  "group relative flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-colors";

function FooterEntry({
  href,
  onClick,
  active = false,
  rail,
  icon: Icon,
  label,
}: {
  href?: string;
  onClick?: () => void;
  active?: boolean;
  rail: boolean;
  icon: typeof Settings;
  label: string;
}) {
  const className = `${FOOTER_LINK} ${rail ? "justify-center px-2 py-2" : "px-3 py-2"} ${
    active
      ? "bg-foreground/[0.08] text-foreground"
      : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
  }`;
  const body = (
    <>
      <span
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
          active ? "bg-primary/12 text-primary" : "text-muted-foreground/80 group-hover:text-foreground"
        }`}
      >
        <Icon size={16} />
      </span>
      {!rail && label}
    </>
  );
  if (href) {
    return (
      <Link href={href} onClick={onClick} title={rail ? label : undefined} aria-current={active ? "page" : undefined} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={rail ? label : undefined} aria-pressed={active} className={className}>
      {body}
    </button>
  );
}

/** Pie del menú: configuración, personalizar, ayuda y perfil. Idéntico en escritorio y móvil. */
export function NavFooter({
  profile,
  pathname,
  rail = false,
  modules,
  edicion = "center",
  onNavigate,
  personalization,
  editing = false,
  onToggleEditing,
}: {
  profile: Profile;
  pathname: string;
  rail?: boolean;
  modules?: AppModule[];
  edicion?: Edicion;
  onNavigate?: () => void;
  personalization?: NavPersonalization;
  editing?: boolean;
  onToggleEditing?: () => void;
}) {
  const helpActive = pathname.startsWith(HELP_HREF);
  const setupHref = setupEntryHref(profile.role, modules, edicion);
  const inSetup = spaceForPath(pathname, profile.role) === "admin";

  return (
    <div className="border-t border-border p-2">
      {editing && !rail && personalization && (
        <div className="mb-2 rounded-lg border border-border bg-surface-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <Star size={11} className="-mt-0.5 mr-1 inline" /> fija arriba ·{" "}
            <Eye size={11} className="-mt-0.5 mr-1 inline" /> oculta del menú. Se guarda en tu cuenta.
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={personalization.reset}
              className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Restaurar menú
            </button>
            <button
              type="button"
              onClick={onToggleEditing}
              className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {setupHref && (
        <FooterEntry
          href={setupHref}
          onClick={onNavigate}
          active={inSetup}
          rail={rail}
          icon={Settings}
          label="Configuración"
        />
      )}
      {personalization && onToggleEditing && !rail && !editing && (
        <FooterEntry onClick={onToggleEditing} rail={rail} icon={SlidersHorizontal} label="Personalizar menú" />
      )}
      <FooterEntry href={HELP_HREF} onClick={onNavigate} active={helpActive} rail={rail} icon={CircleHelp} label="Ayuda" />

      <div className={`mt-1 flex items-center gap-2.5 border-t border-border pt-3 ${rail ? "justify-center" : "px-1"}`}>
        <div className="relative flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(profile.full_name)}
          </div>
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

export function Sidebar({
  profile,
  badges,
  modules,
  edicion = "center",
  duenio = false,
}: {
  profile: Profile;
  badges?: NavBadgeCounts;
  modules?: AppModule[];
  edicion?: Edicion;
  duenio?: boolean;
}) {
  const pathname = usePathname();
  const [rail, setRail] = useState(false);
  const [editing, setEditing] = useState(false);
  const personalization = useNavPersonalization(profile);
  const space = spaceForPath(pathname, profile.role);

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
              <MarcaAtlas edicion={edicion} />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {workspaceLabel(profile.role, space)} · {ROLE_LABEL[profile.role]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setRail(true);
              }}
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
        <NavTree
          profile={profile}
          pathname={pathname}
          rail={rail}
          badges={badges}
          modules={modules}
          edicion={edicion}
          duenio={duenio}
          personalization={personalization}
          editing={editing && !rail}
        />
      </nav>

      <NavFooter
        profile={profile}
        pathname={pathname}
        rail={rail}
        modules={modules}
        edicion={edicion}
        personalization={personalization}
        editing={editing && !rail}
        onToggleEditing={() => setEditing((value) => !value)}
      />
    </aside>
  );
}
