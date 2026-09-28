"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { CalendarClock, History, PhoneOutgoing } from "lucide-react";
import { Callout, EmptyState, SectionCard, buttonClasses } from "@/components/ui";
import type { HomeDashboardSummary } from "@/lib/types";

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
      setRefreshError(error.message);
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

  const { recent, agenda } = summary;

  return (
    <div className="space-y-6">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${live ? "border-success/30 bg-success-bg text-success" : "border-border bg-surface text-muted-foreground"}`}
      >
        <span className="relative inline-flex size-2">
          {live && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />}
          <span className={`relative inline-flex size-2 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`} />
        </span>
        {live ? "Datos en vivo" : "Conectando…"}
      </div>

      {refreshError && (
        <Callout tone="danger" className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span>No se pudo actualizar: {refreshError}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-medium underline underline-offset-2"
          >
            Reintentar
          </button>
        </Callout>
      )}

      <SectionCard
        title="Mis agendas de hoy"
        icon={CalendarClock}
        tone="amber"
        actions={
          agenda.length > 0 && (
            <span className="rounded-full border border-warning/30 bg-warning-bg px-2 py-0.5 text-xs font-semibold tabular-nums text-warning">
              {agenda.length}
            </span>
          )
        }
      >
        {agenda.length === 0 && (
          <EmptyState icon={CalendarClock} title="No tienes agendas pendientes para hoy." className="py-8" />
        )}
        <ul className="divide-y divide-border">
          {agenda.map((a) => {
            const overdue = new Date(a.next_action_at).getTime() < nowTick;
            return (
              <li
                key={a.id}
                className={`flex items-center justify-between border-l-2 px-5 py-3 transition-colors hover:bg-surface-muted/50 ${overdue ? "border-l-danger" : "border-l-transparent"}`}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{a.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.rut ?? a.phone ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted-foreground"}`}>
                    {overdue ? "Vencida: " : ""}
                    {new Date(a.next_action_at).toLocaleString("es-CL")}
                  </span>
                  <Link href={`/dashboard/leads/${a.id}`} className={buttonClasses({ size: "sm" })}>
                    <PhoneOutgoing size={13} aria-hidden="true" />
                    Llamar ahora
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard
        title="Gestiones recientes"
        icon={History}
        tone="blue"
        actions={
          <Link href="/dashboard/leads" className="text-sm font-medium text-primary hover:underline">
            Ver registros
          </Link>
        }
      >
        {recent.length === 0 && (
          <EmptyState icon={History} title="Aún no hay gestiones registradas." className="py-8" />
        )}
        <ul className="divide-y divide-border">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-surface-muted/50">
              <div>
                <p className="text-sm font-medium text-foreground">{r.lead_name}</p>
                <p className="text-xs text-muted-foreground">{r.result}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("es-CL")}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
