"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "@/components/stat-card";
import Link from "next/link";

interface RecentInteraction {
  id: string;
  result: string;
  created_at: string;
  lead_name: string;
}

interface AgendaLead {
  id: string;
  full_name: string;
  rut: string | null;
  phone: string | null;
  next_action_at: string;
}

interface Stats {
  total: number;
  enGestion: number;
  convertidos: number;
}

export function LiveDashboard({
  userId,
  initialStats,
  initialRecent,
  initialAgenda,
}: {
  userId: string;
  initialStats: Stats;
  initialRecent: RecentInteraction[];
  initialAgenda: AgendaLead[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [recent, setRecent] = useState(initialRecent);
  const [agenda, setAgenda] = useState(initialAgenda);
  const [live, setLive] = useState(false);
  // Se actualiza desde un efecto (nunca durante el render) para decidir qué
  // agendas ya están vencidas, sin llamar a Date.now() de forma impura.
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const supabase = createClient();

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [{ count: total }, { count: enGestion }, { count: convertidos }, { data: recientes }, { data: agendaLeads }] =
      await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "en_gestion"),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "convertido"),
        supabase
          .from("interactions")
          .select("id, result, created_at, leads(full_name)")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("leads")
          .select("id, full_name, rut, phone, next_action_at")
          .eq("managed_by", userId)
          .not("next_action_at", "is", null)
          .lte("next_action_at", endOfToday.toISOString())
          .order("next_action_at", { ascending: true })
          .limit(20),
      ]);

    setStats({ total: total ?? 0, enGestion: enGestion ?? 0, convertidos: convertidos ?? 0 });
    setRecent(
      (recientes ?? []).map((r) => ({
        id: r.id,
        result: r.result,
        created_at: r.created_at,
        lead_name:
          (r as unknown as { leads: { full_name: string } | null }).leads?.full_name ?? "Lead",
      }))
    );
    setAgenda(
      (agendaLeads ?? []).map((l) => ({
        id: l.id,
        full_name: l.full_name,
        rut: l.rut,
        phone: l.phone,
        next_action_at: l.next_action_at as string,
      }))
    );
  }, [userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions" }, () => refresh())
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

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
