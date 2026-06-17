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

interface Stats {
  total: number;
  enGestion: number;
  convertidos: number;
}

export function LiveDashboard({
  initialStats,
  initialRecent,
}: {
  initialStats: Stats;
  initialRecent: RecentInteraction[];
}) {
  const [stats, setStats] = useState(initialStats);
  const [recent, setRecent] = useState(initialRecent);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();

    const [{ count: total }, { count: enGestion }, { count: convertidos }, { data: recientes }] =
      await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "en_gestion"),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "convertido"),
        supabase
          .from("interactions")
          .select("id, result, created_at, leads(full_name)")
          .order("created_at", { ascending: false })
          .limit(5),
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
  }, []);

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
