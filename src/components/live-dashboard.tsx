"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "@/components/stat-card";
import Link from "next/link";
import type { HomeDashboardSummary } from "@/lib/types";

export function LiveDashboard({
  initialSummary,
}: {
  initialSummary: HomeDashboardSummary;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [live, setLive] = useState(false);
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

    if (!error && data) {
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

  const { stats, recent, agenda } = summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`}
        />
        <span className="text-xs text-muted-foreground">
          {live ? "Datos en vivo" : "Conectando..."}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Leads visibles" value={stats.total} />
        <StatCard label="En gestión" value={stats.enGestion} />
        <StatCard label="Convertidos" value={stats.convertidos} />
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Mis agendas de hoy</h2>
          {agenda.length > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              {agenda.length}
            </span>
          )}
        </div>
        <ul className="divide-y divide-border">
          {agenda.length === 0 && (
            <li className="px-5 py-4 text-sm text-muted-foreground">
              No tienes agendas pendientes para hoy.
            </li>
          )}
          {agenda.map((a) => {
            const overdue = new Date(a.next_action_at).getTime() < nowTick;
            return (
              <li key={a.id} className="flex items-center justify-between px-5 py-3">
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
                  <Link
                    href={`/dashboard/leads/${a.id}`}
                    className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    Llamar ahora
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Gestiones recientes</h2>
          <Link href="/dashboard/leads" className="text-sm text-primary hover:underline">
            Ver leads
          </Link>
        </div>
        <ul className="divide-y divide-border">
          {recent.length === 0 && (
            <li className="px-5 py-4 text-sm text-muted-foreground">
              Aún no hay gestiones registradas.
            </li>
          )}
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-5 py-3">
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
      </div>
    </div>
  );
}
