"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowUpRight, CalendarClock, Clock3, CornerDownLeft, Loader2, Moon, Radar, Search, Sun, Upload, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";
import type { AppModule } from "@/lib/modules";
import type { Edicion } from "@/lib/ediciones";
import { allItemsForRole, navLabel } from "@/lib/nav.config";
import { Avatar } from "@/components/ui";

interface QuickResult {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  status: string;
  match_type: "rut" | "phone" | "name";
}

type RecentLead = Omit<QuickResult, "match_type">;

const RECENT_LEADS_KEY = "atlas:quick-search:recent-leads";

function readRecentLeads(storageKey: string): RecentLead[] {
  try {
    const stored = window.localStorage.getItem(storageKey);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is RecentLead =>
      Boolean(item && typeof item.id === "string" && typeof item.full_name === "string")
    ).slice(0, 5) : [];
  } catch {
    return [];
  }
}

const MATCH_LABEL: Record<QuickResult["match_type"], string> = {
  rut: "RUT",
  phone: "Teléfono",
  name: "Nombre",
};

/**
 * Buscador global de leads y salto a destinos. La búsqueda respeta las
 * políticas de visibilidad de la RPC; los destinos se derivan de
 * `nav.config.ts`, así el menú y la paleta nunca divergen.
 */
export function QuickSearch({
  role,
  userId,
  modules,
  edicion,
}: {
  role: AppRole;
  userId: string;
  modules?: AppModule[];
  edicion?: Edicion;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<QuickResult[]>([]);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const destinations = useMemo(() => allItemsForRole(role, modules, edicion), [role, modules, edicion]);
  const storageKey = `${RECENT_LEADS_KEY}:${userId}:${role}`;
  const { resolvedTheme, setTheme } = useTheme();
  // Lo que se hace a menudo, según el rol: la paleta no solo busca, también hace.
  const quickActions = useMemo<QuickAction[]>(() => {
    const center = edicion === "center";
    const manage = role === "supervisor" || role === "admin";
    const list: QuickAction[] = [];
    if (center && manage) list.push({ id: "fuera-de-base", label: "Ingresar un registro fuera de base", icon: UserPlus, tone: "primary", href: "/dashboard/leads/nuevo" });
    if (center && manage) list.push({ id: "importar", label: "Importar una base (CSV o Excel)", icon: Upload, tone: "teal", href: "/dashboard/admin/cargas" });
    if (center && manage) list.push({ id: "monitor", label: "Abrir el monitor en vivo", icon: Radar, tone: "violet", href: "/dashboard/supervision/monitor" });
    if (center && role === "agente") list.push({ id: "agenda", label: "Ver mi agenda de hoy", icon: CalendarClock, tone: "amber", href: "/dashboard/agenda" });
    list.push({
      id: "tema",
      label: resolvedTheme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro",
      icon: resolvedTheme === "dark" ? Sun : Moon,
      tone: "blue",
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    });
    return list;
  }, [edicion, role, resolvedTheme, setTheme]);
  const visibleDestinations = destinations.filter((item) =>
    `${navLabel(item, role)} ${item.description}`.toLocaleLowerCase("es").includes(term.trim().toLocaleLowerCase("es"))
  );

  const openPalette = useCallback(() => {
    setRecentLeads(readRecentLeads(storageKey));
    setOpen(true);
  }, [storageKey]);

  const close = useCallback(() => {
    setOpen(false);
    setTerm("");
    setResults([]);
    setNotFound(false);
    setSearchError(false);
    setActiveIndex(0);
  }, []);

  const saveRecentLead = useCallback((lead: RecentLead) => {
    setRecentLeads((current) => {
      const next = [lead, ...current.filter((item) => item.id !== lead.id)].slice(0, 5);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // La búsqueda sigue funcionando si el almacenamiento local está bloqueado.
      }
      return next;
    });
  }, [storageKey]);

  const goToLead = useCallback(
    (lead: QuickResult | RecentLead) => {
      saveRecentLead({
        id: lead.id,
        full_name: lead.full_name,
        rut: lead.rut,
        phone: lead.phone,
        status: lead.status,
      });
      close();
      router.push(`/dashboard/leads/${lead.id}`);
    },
    [close, router, saveRecentLead]
  );

  const goToAction = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, openPalette]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());
    function containFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", containFocus);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open) return;
    let cancelled = false;

    debounceRef.current = setTimeout(async () => {
      const trimmed = term.trim();
      if (!trimmed) {
        setResults([]);
        setNotFound(false);
        setLoading(false);
        setSearchError(false);
        return;
      }

      setLoading(true);
      setSearchError(false);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_leads_quick", { p_term: trimmed });
      if (cancelled) return;
      setLoading(false);

      if (error || !data) {
        setResults([]);
        setSearchError(true);
        setNotFound(false);
        return;
      }

      const rows = data as QuickResult[];
      setResults(rows);
      setActiveIndex(0);
      setNotFound(rows.length === 0);

      // Abrir un registro siempre requiere elegirlo: encontrar una coincidencia
      // no debe sacar al administrador de su espacio de control automáticamente.
    }, 200);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, open]);

  if (!open) {
    return (
      <button
        onClick={openPalette}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-muted-foreground shadow-sm transition-colors hover:border-border-strong hover:text-foreground sm:w-72 lg:w-80"
      >
        <Search size={15} aria-hidden="true" />
        <span className="hidden sm:inline">Buscar registros, RUT o ir a…</span>
        <span className="sr-only sm:hidden">Buscar o ir a una sección</span>
        <kbd className="ml-auto hidden rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline">⌘K</kbd>
      </button>
    );
  }

  const isEmpty = !term.trim() && !loading;
  const needle = term.trim().toLocaleLowerCase("es");
  const visibleActions = quickActions.filter((action) => !needle || action.label.toLocaleLowerCase("es").includes(needle));
  // Sin texto, la lista de destinos completa abrumaba: se muestran los seis
  // primeros y el resto aparece al escribir.
  const shownDestinations = isEmpty ? visibleDestinations.slice(0, 6) : visibleDestinations;
  const groupTitle = "px-2.5 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/70";
  const row = "group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:bg-surface-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-3 pt-16 backdrop-blur-[2px] sm:pt-24" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar registros y secciones"
        className="hover-card-in flex max-h-[calc(100dvh-8rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface-solid shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          {loading ? <Loader2 size={18} className="animate-spin text-muted-foreground" /> : <Search size={18} className="text-muted-foreground" />}
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setResults([]);
              setActiveIndex(0);
              setNotFound(false);
              setSearchError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && results[activeIndex]) {
                goToLead(results[activeIndex]);
              }
            }}
            placeholder="Busca un RUT, teléfono, nombre o escribe qué quieres hacer…"
            aria-label="Buscar una sección o un registro"
            className="h-14 w-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">Esc</kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* Registros primero: es lo que se busca nueve de cada diez veces. */}
          {results.length > 0 && (
            <section>
              <p className={groupTitle}>Registros</p>
              <ul>
                {results.map((result, index) => (
                  <li key={result.id}>
                    <button
                      onClick={() => goToLead(result)}
                      className={`${row} ${index === activeIndex ? "bg-surface-muted" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <Avatar name={result.full_name} seed={result.rut ?? result.full_name} size="md" shape="square" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{result.full_name}</span>
                        <span className="block truncate text-xs tabular-nums text-muted-foreground">{result.rut ?? "Sin RUT"} · {result.phone ?? "Sin teléfono"}</span>
                      </span>
                      <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {MATCH_LABEL[result.match_type]}
                      </span>
                      <CornerDownLeft size={14} className={`text-muted-foreground ${index === activeIndex ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notFound && term.trim() && !loading && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No se encontró ningún registro para &ldquo;{term.trim()}&rdquo;.</p>
          )}
          {searchError && !loading && (
            <p role="status" className="px-3 py-4 text-sm text-danger">
              No fue posible consultar registros. Los accesos a secciones siguen disponibles; intenta buscar nuevamente.
            </p>
          )}

          {visibleActions.length > 0 && (
            <section>
              <p className={groupTitle}>Acciones</p>
              {visibleActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.id} onClick={() => (action.href ? goToAction(action.href) : (action.run?.(), close()))} className={row}>
                    <span className="icon-chip size-8 rounded-lg" data-tone={action.tone}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{action.label}</span>
                    <ArrowUpRight size={14} className="text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
                  </button>
                );
              })}
            </section>
          )}

          {isEmpty && recentLeads.length > 0 && (
            <section>
              <p className={groupTitle}>Abiertos hace poco</p>
              {recentLeads.map((lead) => (
                <button key={lead.id} onClick={() => goToLead(lead)} className={row}>
                  <Avatar name={lead.full_name} seed={lead.rut ?? lead.full_name} size="md" shape="square" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{lead.full_name}</span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">{lead.rut ?? "Sin RUT"} · {lead.phone ?? "Sin teléfono"}</span>
                  </span>
                  <Clock3 size={14} className="text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </section>
          )}

          {shownDestinations.length > 0 && (
            <section>
              <p className={groupTitle}>Ir a</p>
              {shownDestinations.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} onClick={() => goToAction(item.href)} className={row}>
                    <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{navLabel(item, role)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                    </span>
                    <ArrowUpRight size={14} className="text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
                  </button>
                );
              })}
            </section>
          )}
        </div>

        {/* Atajos a la vista: la paleta se usa con el teclado. */}
        <div className="flex items-center gap-4 border-t border-border bg-surface-raised px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> moverse</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> abrir</span>
          <span className="ml-auto flex items-center gap-1.5"><Kbd>⌘</Kbd><Kbd>K</Kbd> abrir desde cualquier pantalla</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-surface px-1 font-sans text-[10px] font-medium">{children}</kbd>;
}

type QuickAction = {
  id: string;
  label: string;
  icon: typeof Search;
  tone: "primary" | "blue" | "teal" | "green" | "amber" | "violet";
  href?: string;
  run?: () => void;
};
