"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, RotateCcw, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistentState } from "@/lib/persistent-state";
import { buttonClasses } from "./button";

type SavedView = { id: string; name: string; query: string };

const NO_VIEWS: SavedView[] = [];

/**
 * Barra de filtros única, con vistas guardadas.
 *
 * Los filtros siguen viviendo en la URL (server components leen `searchParams`),
 * así que una "vista" es simplemente un querystring con nombre. Es el patrón de
 * Five9 y HubSpot: el usuario deja de rearmar el mismo filtro veinte veces al día.
 */
export function FilterBar({
  children,
  storageKey,
  systemViews,
  applyLabel = "Filtrar",
  className,
}: {
  children: ReactNode;
  /** Habilita las vistas guardadas y las persiste por pantalla. */
  storageKey?: string;
  /** Vistas fijas del producto, que no se pueden borrar. */
  systemViews?: { name: string; query: string }[];
  applyLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const hasFilters = currentQuery.length > 0;

  const [views, setViews] = usePersistentState<SavedView[]>(
    storageKey ? `atlas.views.${storageKey}` : "atlas.views.none",
    NO_VIEWS
  );
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const go = (query: string) => router.push(query ? `${pathname}?${query}` : pathname);

  const saveView = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((current) => [
      ...current.filter((view) => view.name !== trimmed),
      { id: `${Date.now()}`, name: trimmed, query: currentQuery },
    ]);
    setName("");
    setNaming(false);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {storageKey && (systemViews?.length || views.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {systemViews?.map((view) => (
            <button
              key={view.name}
              type="button"
              onClick={() => go(view.query)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                currentQuery === view.query
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
            >
              {view.name}
            </button>
          ))}

          {views.map((view) => (
            <span
              key={view.id}
              className={cn(
                "group inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                currentQuery === view.query
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              )}
            >
              <button type="button" onClick={() => go(view.query)} className="inline-flex items-center gap-1.5">
                <Star size={12} aria-hidden="true" />
                {view.name}
              </button>
              <button
                type="button"
                onClick={() => setViews((current) => current.filter((item) => item.id !== view.id))}
                aria-label={`Eliminar la vista ${view.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        {children}

        <div className="ml-auto flex items-end gap-2">
          <button type="submit" className={buttonClasses()}>
            {applyLabel}
          </button>

          {hasFilters && (
            <>
              <button
                type="button"
                onClick={() => go("")}
                className={buttonClasses({ variant: "ghost" })}
                title="Quitar todos los filtros"
              >
                <RotateCcw size={15} aria-hidden="true" />
                Limpiar
              </button>

              {storageKey && !naming && (
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  className={buttonClasses({ variant: "secondary" })}
                  title="Guardar estos filtros como una vista"
                >
                  <Bookmark size={15} aria-hidden="true" />
                  Guardar vista
                </button>
              )}
            </>
          )}
        </div>

        {naming && (
          <div className="flex w-full items-end gap-2 border-t border-border pt-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveView();
                }
              }}
              placeholder="Nombre de la vista"
              aria-label="Nombre de la vista"
              className="h-9 w-56 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button type="button" onClick={saveView} className={buttonClasses({ size: "sm" })}>
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              Cancelar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
