"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Clock3, Loader2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";
import { allItemsForRole, navLabel } from "@/lib/nav.config";

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
export function QuickSearch({ role, userId }: { role: AppRole; userId: string }) {
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
  const destinations = useMemo(() => allItemsForRole(role), [role]);
  const storageKey = `${RECENT_LEADS_KEY}:${userId}:${role}`;
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
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <Search size={15} />
        <span className="hidden sm:inline">Buscar o ir a...</span>
        <span className="sr-only sm:hidden">Buscar o ir a una sección</span>
        <kbd className="ml-2 hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">⌘K</kbd>
      </button>
    );
  }

  const isEmpty = !term.trim() && !loading;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-16 sm:pt-24" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Buscar registros y secciones" className="max-h-[calc(100dvh-8rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {loading ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Search size={16} className="text-muted-foreground" />}
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
            placeholder="Buscar una sección, RUT, teléfono o nombre…"
            aria-label="Buscar una sección o un registro"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Esc</kbd>
        </div>

        {visibleDestinations.length > 0 && (
          <div className="max-h-[26rem] overflow-y-auto p-3">
            <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ir a</p>
            <div className="space-y-1">
              {visibleDestinations.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} onClick={() => goToAction(item.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-muted">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{navLabel(item, role)}</span>
                      <span className="block text-xs text-muted-foreground">{item.description}</span>
                    </span>
                    <ArrowUpRight size={15} className="text-muted-foreground" />
                  </button>
                );
              })}
            </div>

            {isEmpty && recentLeads.length > 0 && (
              <>
                <p className="mt-5 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Últimos registros abiertos</p>
                <div className="space-y-1">
                  {recentLeads.map((lead) => (
                    <button key={lead.id} onClick={() => goToLead(lead)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-muted">
                      <Clock3 size={16} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{lead.full_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{lead.rut ?? "Sin RUT"} · {lead.phone ?? "Sin teléfono"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.map((result, index) => (
              <li key={result.id}>
                <button
                  onClick={() => goToLead(result)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${index === activeIndex ? "bg-surface-muted" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span>
                    <span className="block font-medium text-foreground">{result.full_name}</span>
                    <span className="block text-xs text-muted-foreground">{result.rut ?? "—"} · {result.phone ?? "—"}</span>
                  </span>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">{MATCH_LABEL[result.match_type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {notFound && term.trim() && !loading && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No se encontró ningún registro para &ldquo;{term.trim()}&rdquo;.</p>}
        {searchError && !loading && <p role="status" className="px-4 py-4 text-sm text-danger">No fue posible consultar registros. Los accesos a secciones siguen disponibles; intenta buscar nuevamente.</p>}
      </div>
    </div>
  );
}
