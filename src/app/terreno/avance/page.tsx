import Link from "next/link";

import { EmbudoBarras, sumarEmbudo } from "@/components/terreno/embudo-barras";
import { requireProfile } from "@/lib/auth";
import { addDays, endOfDay, startOfDay } from "@/lib/report-range";
import { createClient } from "@/lib/supabase/server";
import type { EmbudoVendedor } from "@/lib/terreno";
import { campanaTerrenoActual } from "@/lib/terreno.server";
import { cn } from "@/lib/utils";

const PERIODOS = {
  hoy: { label: "Hoy", dias: 0 },
  semana: { label: "7 días", dias: 6 },
  mes: { label: "30 días", dias: 29 },
} as const;
type Periodo = keyof typeof PERIODOS;

export default async function TerrenoAvancePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const campana = await campanaTerrenoActual();
  if (!campana) return null;
  const { p } = await searchParams;
  const periodo: Periodo = p && p in PERIODOS ? (p as Periodo) : "hoy";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("terreno_embudo", {
    p_campaign_id: campana.id,
    p_desde: startOfDay(addDays(new Date(), -PERIODOS[periodo].dias)).toISOString(),
    p_hasta: endOfDay(new Date()).toISOString(),
  });
  if (error) console.error("[terreno] no se pudo leer el avance", error.message);
  const mia = ((data ?? []) as EmbudoVendedor[]).filter((fila) => fila.vendedor_id === profile.id);
  const t = sumarEmbudo(mia);

  const kpis = [
    { label: "Visitas", valor: t.visitas },
    { label: "Clientes nuevos", valor: t.clientes },
    { label: "Ventas", valor: t.ventas, destaca: true },
    { label: "Lectores vendidos", valor: t.lectores },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Mi avance</h1>

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1" role="tablist" aria-label="Período">
        {(Object.keys(PERIODOS) as Periodo[]).map((clave) => (
          <Link
            key={clave}
            href={`/terreno/avance?p=${clave}`}
            role="tab"
            aria-selected={periodo === clave}
            className={cn(
              "flex h-11 items-center justify-center rounded-lg text-sm font-medium",
              periodo === clave ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {PERIODOS[clave].label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          No pudimos cargar tu avance. Revisa la señal y vuelve a abrir esta pantalla.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className={cn("rounded-xl border bg-surface p-4", kpi.destaca ? "border-success/40" : "border-border")}
              >
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className={cn("mt-1 text-3xl font-semibold tabular-nums", kpi.destaca && "text-success")}>{kpi.valor}</p>
              </div>
            ))}
          </div>

          <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div>
              <h2 className="text-base font-semibold">Embudo de tus clientes</h2>
              <p className="text-xs text-muted-foreground">Clientes ingresados en el período y hasta dónde llegaron.</p>
            </div>
            {t.clientes === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Aún no ingresas clientes en este período.</p>
            ) : (
              <EmbudoBarras totales={t} />
            )}
          </section>

          {t.visitas > 0 && t.visitas_con_gps < t.visitas && (
            <p className="text-sm text-muted-foreground">
              {t.visitas - t.visitas_con_gps} de tus visitas quedaron sin ubicación. Activa el GPS para que cuenten completas.
            </p>
          )}
        </>
      )}
    </div>
  );
}
