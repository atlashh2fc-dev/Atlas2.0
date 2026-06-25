"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface QuickResult {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  status: string;
  match_type: "rut" | "phone" | "name";
}

const MATCH_LABEL: Record<QuickResult["match_type"], string> = {
  rut: "RUT",
  phone: "Teléfono",
  name: "Nombre",
};

/**
 * Buscador global de leads (Cmd/Ctrl+K), disponible desde cualquier
 * pantalla del dashboard. Reemplaza el flujo de "ir a /dashboard/leads,
 * escribir, esperar recarga de página, buscar la fila en una tabla":
 * el agente mete rut o teléfono (en cualquier formato) y, si hay un único
 * match exacto, entra directo a la ficha — mismo "screen-pop" que ya
 * existe para el discador automático, pero disparado a mano.
 *
 * Usa la función search_leads_quick (RPC en Postgres), que normaliza el
 * término igual que los índices funcionales idx_leads_rut_norm /
 * idx_leads_phone_norm, en vez del ILIKE %term% de la página de leads
 * (que no puede usar ningún índice y escanea toda la tabla).
 */
export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<QuickResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const close = useCallback(() => {
    setOpen(false);
    setTerm("");
    setResults([]);
    setNotFound(false);
    setActiveIndex(0);
  }, []);

  const goToLead = useCallback(
    (id: string) => {
      close();
      router.push(`/dashboard/leads/${id}`);
    },
    [close, router]
  );

  // Atajo global: Cmd/Ctrl+K abre el buscador desde cualquier pantalla.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    if (open) {
      // Esperar al siguiente frame: el input recién se monta.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const trimmed = term.trim();
      if (!trimmed) {
        setResults([]);
        setNotFound(false);
        return;
      }

      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_leads_quick", {
        p_term: trimmed,
      });
      setLoading(false);

      if (error || !data) {
        setResults([]);
        setNotFound(true);
        return;
      }

      const rows = data as QuickResult[];
      setResults(rows);
      setActiveIndex(0);
      setNotFound(rows.length === 0);

      // Match único y exacto (rut o teléfono, no nombre) → directo a la ficha.
      if (rows.length === 1 && rows[0].match_type !== "name") {
        goToLead(rows[0].id);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, goToLead]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <Search size={15} />
        <span>Buscar lead...</span>
        <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          ) : (
            <Search size={16} className="text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[activeIndex]) {
                goToLead(results[activeIndex].id);
              }
            }}
            placeholder="RUT, teléfono o nombre..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Esc
          </kbd>
        </div>

        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => goToLead(r.id)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                    i === activeIndex ? "bg-surface-muted" : ""
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div>
                    <p className="font-medium text-foreground">{r.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.rut ?? "—"} · {r.phone ?? "—"}
                    </p>
                  </div>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                    {MATCH_LABEL[r.match_type]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {notFound && term.trim() && !loading && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No se encontró ningún lead para &ldquo;{term.trim()}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
