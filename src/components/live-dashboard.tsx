"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { CalendarClock, CalendarX2, ChevronRight, CircleCheckBig, Database, History, Workflow } from "lucide-react";
import { Avatar, Badge, Callout, EmptyState, SectionCard } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import type { HomeDashboardSummary } from "@/lib/types";

const hourFormat = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short" });

/** "Hace 5 min", "Hace 3 h", "Ayer · 09:27": lo reciente se lee por antigüedad. */
function relativeLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Recién";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const date = new Date(iso);
  return `${dayFormat.format(date).replace(".", "")} · ${hourFormat.format(date)}`;
}

/** "VOLVER A LLAMAR" → "Volver a llamar": las mayúsculas de la base gritan. */
function sentenceCase(text: string): string {
  if (!text || text !== text.toUpperCase()) return text;
  const lower = text.toLocaleLowerCase("es-CL");
  return lower.charAt(0).toLocaleUpperCase("es-CL") + lower.slice(1);
}

export function LiveDashboard({
  initialSummary,
}: {
  initialSummary: HomeDashboardSummary;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [live, setLive] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Se actualiza desde un efecto (nunca durante el render) para decidir qué
  // agendas ya están vencidas, sin llamar a Date.now() de forma impura.
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_home_dashboard_summary");

    if (error) {
      // Antes el fallo del refresco quedaba en silencio y la pantalla mostraba
      // datos viejos como si estuvieran al día.
      console.error("No se pudo actualizar el resumen del inicio", error);
      setRefreshError("Lo que ves puede estar desactualizado. Revisa tu conexión y reintenta.");
      return;
    }
    if (data) {
      setRefreshError(null);
      setSummary(data as HomeDashboardSummary);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 300);
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions" }, scheduleRefresh)
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);

  const { recent, agenda, stats } = summary;
  const overdueCount = agenda.filter((a) => new Date(a.next_action_at).getTime() < nowTick).length;
  const fmt = (n: number) => n.toLocaleString("es-CL");

  return (
    <div className="space-y-5">
      {refreshError && (
        <Callout tone="danger" className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span>No se pudo actualizar. {refreshError}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-medium underline underline-offset-2"
          >
            Reintentar
          </button>
        </Callout>
      )}

      <KpiStrip
        title="Tu día"
        meta={
          <span className={`inline-flex items-center gap-2 font-medium ${live ? "text-success" : "text-muted-foreground"}`}>
            <span className="relative inline-flex size-2">
              {live && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />}
              <span className={`relative inline-flex size-2 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`} />
            </span>
            {live ? "En vivo" : "Conectando…"}
          </span>
        }
      >
        <KpiStripItem
          label="Vencidas"
          icon={CalendarX2}
          value={fmt(overdueCount)}
          tone={overdueCount > 0 ? "danger" : "default"}
          detail="Agendas de hoy ya pasadas"
          href="/dashboard/leads?view=vencidas"
        />
        <KpiStripItem
          label="Agendas de hoy"
          icon={CalendarClock}
          value={fmt(agenda.length)}
          detail="Seguimientos comprometidos"
          href="/dashboard/leads?view=hoy"
        />
        <KpiStripItem
          label="En gestión"
          icon={Workflow}
          value={fmt(stats.enGestion)}
          detail="Registros abiertos"
          progress={stats.total > 0 ? (stats.enGestion / stats.total) * 100 : undefined}
        />
        <KpiStripItem
          label="Convertidos"
          icon={CircleCheckBig}
          value={fmt(stats.convertidos)}
          tone={stats.convertidos > 0 ? "good" : "default"}
          detail="Cierres en tu cartera"
          progress={stats.total > 0 ? (stats.convertidos / stats.total) * 100 : undefined}
        />
        <KpiStripItem
          label="Mi cartera"
          icon={Database}
          value={fmt(stats.total)}
          detail="Registros asignados"
          href="/dashboard/leads"
        />
      </KpiStrip>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          title="Mis agendas de hoy"
          description="En orden de hora. Abre la ficha para gestionar y marcar."
          actions={
            agenda.length > 0 && (
              <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-foreground">
                {agenda.length}
              </span>
            )
          }
        >
          {agenda.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No tienes agendas pendientes para hoy." className="py-8" />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {agenda.map((a) => {
                const at = new Date(a.next_action_at);
                const overdue = at.getTime() < nowTick;
                return (
                  <li key={a.id}>
                    {/* Toda la fila abre la ficha; desde ahí se marca. */}
                    <Link
                      href={`/dashboard/leads/${a.id}`}
                      className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className={`w-12 shrink-0 text-sm font-semibold tabular-nums ${overdue ? "text-danger" : "text-foreground"}`}>
                        {hourFormat.format(at)}
                      </span>
                      <Avatar name={a.full_name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{a.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.rut ?? a.phone ?? "Sin RUT ni teléfono"}</p>
                      </div>
                      {overdue && <Badge tone="danger">Vencida</Badge>}
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Gestiones recientes"
          actions={
            <Link href="/dashboard/leads" className="text-xs font-medium text-primary hover:underline">
              Ver registros
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState icon={History} title="Aún no hay gestiones registradas." className="py-8" />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={r.lead_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{r.lead_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{sentenceCase(r.result)}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relativeLabel(r.created_at, nowTick)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
