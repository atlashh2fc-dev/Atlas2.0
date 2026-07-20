"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Clock3, Loader2, Search, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

interface QuickResult {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  status: string;
  match_type: "rut" | "phone" | "name";
}

type RecentLead = Omit<QuickResult, "match_type">;
type QuickAction = { label: string; description: string; href: string };

const RECENT_LEADS_KEY = "atlas:quick-search:recent-leads";

const MATCH_LABEL: Record<QuickResult["match_type"], string> = {
  rut: "RUT",
  phone: "Teléfono",
  name: "Nombre",
};

const QUICK_ACTIONS: Record<AppRole, QuickAction[]> = {
  agente: [
    { label: "Mis registros", description: "Gestionar leads asignados", href: "/dashboard/leads" },
    { label: "Mi agenda", description: "Seguimientos de hoy y vencidos", href: "/dashboard/agenda" },
    { label: "Centro de ayuda", description: "Guías para tu operación", href: "/dashboard/ayuda" },
  ],
  supervisor: [
    { label: "Mi equipo", description: "Carga y registros del equipo", href: "/dashboard/team" },
    { label: "Monitor en vivo", description: "Disponibilidad de ejecutivos", href: "/dashboard/supervision/monitor" },
    { label: "Reportes de gestión", description: "Indicadores y desempeño", href: "/dashboard/reportes" },
    { label: "Leads mail", description: "Entrada y asignación de correos", href: "/dashboard/mail" },
  ],
  admin: [
    { label: "Crear campaña", description: "Configurar una nueva operación", href: "/dashboard/admin/campanas" },
    { label: "Cargar leads", description: "Importar una base de datos", href: "/dashboard/leads/cargar" },
    { label: "Crear flujo", description: "Diseñar el guion de gestión", href: "/dashboard/admin/flujos" },
    { label: "Usuarios y equipos", description: "Roles, equipos y supervisores", href: "/dashboard/admin/usuarios" },
  ],
};

/**
 * Buscador global de leads y lanzador de acciones frecuentes. La búsqueda
 * respeta las políticas de visibilidad de la RPC; los accesos rápidos se
 * filtran por el rol del usuario que abrió el dashboard.
 */
export function QuickSearch({ role }: { role: AppRole }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<QuickResult[]>([]);
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([]);
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

  const saveRecentLead = useCallback((lead: RecentLead) => {
    setRecentLeads((current) => {
      const next = [lead, ...current.filter((item) => item.id !== lead.id)].slice(0, 5);
      window.localStorage.setItem(RECENT_LEADS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

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
        setOpen(true);
      }
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    try {
      const stored = window.localStorage.getItem(RECENT_LEADS_KEY);
      if (stored) setRecentLeads(JSON.parse(stored) as RecentLead[]);
    } catch {
      window.localStorage.removeItem(RECENT_LEADS_KEY);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const trimmed = term.trim();
      if (!trimmed) {
        setResults([]);
        setNotFound(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_leads_quick", { p_term: trimmed });
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

      if (rows.length === 1 && rows[0].match_type !== "name") goToLead(rows[0]);
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
        <span>Buscar o ir a...</span>
        <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
      </button>
    );
  }

  const isEmpty = !term.trim() && !loading;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={close}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {loading ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Search size={16} className="text-muted-foreground" />}
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && results[activeIndex]) {
                goToLead(results[activeIndex]);
              }
            }}
            placeholder="Buscar lead por RUT, teléfono o nombre..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Esc</kbd>
        </div>

        {isEmpty && (
          <div className="max-h-[26rem] overflow-y-auto p-3">
            <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Acciones frecuentes</p>
            <div className="space-y-1">
              {QUICK_ACTIONS[role].map((action) => (
                <button key={action.href} onClick={() => goToAction(action.href)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-muted">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Zap size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{action.label}</span>
                    <span className="block text-xs text-muted-foreground">{action.description}</span>
                  </span>
                  <ArrowUpRight size={15} className="text-muted-foreground" />
                </button>
              ))}
            </div>

            {recentLeads.length > 0 && (
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

        {notFound && term.trim() && !loading && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No se encontró ningún lead para &ldquo;{term.trim()}&rdquo;.</p>}
      </div>
    </div>
  );
}
