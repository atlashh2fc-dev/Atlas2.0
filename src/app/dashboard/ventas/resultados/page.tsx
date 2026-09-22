import { unstable_noStore as noStore } from "next/cache";

import { alternarSeguimientoAutomatico } from "@/app/actions/pipeline";
import { Callout, EmptyState, NavTabs, PageHeader, SectionCard, SubmitButton } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Resultados del pipeline: conversión por etapa y por origen, tiempos y
 * proyección. Los datos son los mismos negocios; acá se miran de lejos.
 */

const DIA = 24 * 60 * 60 * 1000;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const ORIGEN: Record<string, string> = { agenda_web: "Web", agente_calificador: "Calificador IA", atlas_lead: "Atlas Lead", manual: "Manual" };

type Negocio = { id: string; status: string; monthly_amount: number | null; one_time_amount: number | null; stage_id: string; source: string | null; created_at: string; closed_at: string | null; owner_id: string | null };
type Etapa = { id: string; name: string; position: number; probability: number | null; is_won: boolean; is_lost: boolean };

export default async function ResultadosPage() {
  noStore();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";

  const supabase = await createClient();
  const [{ data: etapasData }, { data: negociosData }, { data: cambios }, { data: personas }, { data: org }, { data: seguimientos }] = await Promise.all([
    supabase.from("sales_stages").select("id, name, position, probability, is_won, is_lost").eq("active", true).order("position"),
    supabase.from("sales_opportunities").select("id, status, monthly_amount, one_time_amount, stage_id, source, created_at, closed_at, owner_id").limit(3000),
    supabase.from("sales_activities").select("opportunity_id, subject, occurred_at").eq("kind", "etapa").limit(6000),
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase.from("organizations").select("settings").limit(1).maybeSingle(),
    supabase.from("mensajes_salientes").select("estado").eq("regla", "seguimiento").limit(2000),
  ]);
  const etapas = (etapasData ?? []) as Etapa[];
  const negocios = (negociosData ?? []) as Negocio[];
  const monto = (negocio: Negocio) => Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const nombres = new Map((personas ?? []).map((persona) => [persona.id as string, persona.full_name as string]));

  const abiertos = negocios.filter((negocio) => negocio.status === "abierta");
  const cerrados = negocios.filter((negocio) => negocio.status !== "abierta");
  const ganados = cerrados.filter((negocio) => negocio.status === "ganada");
  const tasa = cerrados.length ? Math.round((ganados.length / cerrados.length) * 100) : null;
  const diasCierre = ganados.filter((negocio) => negocio.closed_at).map((negocio) => (new Date(negocio.closed_at as string).getTime() - new Date(negocio.created_at).getTime()) / DIA);
  const promedioCierre = diasCierre.length ? Math.round(diasCierre.reduce((total, dias) => total + dias, 0) / diasCierre.length) : null;
  const ponderado = abiertos.reduce((total, negocio) => total + monto(negocio) * ((etapas.find((etapa) => etapa.id === negocio.stage_id)?.probability ?? 0) / 100), 0);

  // Cuántos negocios pasaron por cada etapa (por los cambios registrados) y cuántos están hoy.
  const alcanzaron = new Map<string, Set<string>>();
  for (const cambio of cambios ?? []) {
    const asunto = String(cambio.subject ?? "");
    const etapa = etapas.find((candidata) => asunto.toLowerCase().includes(candidata.name.toLowerCase()));
    if (!etapa) continue;
    const set = alcanzaron.get(etapa.id) ?? new Set<string>();
    set.add(cambio.opportunity_id as string);
    alcanzaron.set(etapa.id, set);
  }
  for (const negocio of negocios) {
    const set = alcanzaron.get(negocio.stage_id) ?? new Set<string>();
    set.add(negocio.id);
    alcanzaron.set(negocio.stage_id, set);
  }

  const porOrigen = [...new Set(negocios.map((negocio) => negocio.source ?? "manual"))].map((origen) => {
    const propios = negocios.filter((negocio) => (negocio.source ?? "manual") === origen);
    const cerradosPropios = propios.filter((negocio) => negocio.status !== "abierta");
    const ganadosPropios = cerradosPropios.filter((negocio) => negocio.status === "ganada");
    return { origen, total: propios.length, abiertos: propios.filter((negocio) => negocio.status === "abierta").length, ganados: ganadosPropios.length, tasa: cerradosPropios.length ? Math.round((ganadosPropios.length / cerradosPropios.length) * 100) : null, monto: ganadosPropios.reduce((total, negocio) => total + monto(negocio), 0) };
  }).sort((a, b) => b.total - a.total);

  const porResponsable = [...new Set(negocios.map((negocio) => negocio.owner_id ?? "nadie"))].map((owner) => {
    const propios = negocios.filter((negocio) => (negocio.owner_id ?? "nadie") === owner);
    return { nombre: owner === "nadie" ? "Sin responsable" : nombres.get(owner) ?? "—", abiertos: propios.filter((negocio) => negocio.status === "abierta").length, ganados: propios.filter((negocio) => negocio.status === "ganada").length, monto: propios.filter((negocio) => negocio.status === "ganada").reduce((total, negocio) => total + monto(negocio), 0) };
  }).sort((a, b) => b.abiertos - a.abiertos);

  const seguimientoActivo = ((org?.settings as Record<string, unknown> | null)?.seguimiento_automatico ?? false) === true;
  const seguimientosEnviados = (seguimientos ?? []).filter((mensaje) => ["enviado", "entregado", "leido", "respondido"].includes(mensaje.estado as string)).length;
  const seguimientosRespondidos = (seguimientos ?? []).filter((mensaje) => mensaje.estado === "respondido").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Resultados" description={`${empresa ?? voc.titulo} · ${negocios.length} negocios en total · ${abiertos.length} abiertos`} />
      <NavTabs tabs={[{ label: "Pipeline", href: "/dashboard/pipeline" }, { label: "Lista", href: "/dashboard/ventas" }, { label: "Resultados", href: "/dashboard/ventas/resultados" }, { label: "Respuestas del agente", href: "/dashboard/ventas/respuestas" }]} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Tasa de cierre", valor: tasa === null ? "—" : `${tasa}%`, detalle: `${ganados.length} ganados de ${cerrados.length} cerrados` },
          { label: "Días hasta cerrar", valor: promedioCierre === null ? "—" : `${promedioCierre} d`, detalle: "Promedio de los ganados" },
          { label: "En juego", valor: pesos.format(abiertos.reduce((total, negocio) => total + monto(negocio), 0)), detalle: `${pesos.format(ponderado)} ponderado por etapa` },
          { label: "Seguimientos automáticos", valor: String(seguimientosEnviados), detalle: `${seguimientosRespondidos} respondidos · ${seguimientoActivo ? "activo" : "apagado"}` },
        ].map((metrica) => (
          <div key={metrica.label} className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{metrica.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metrica.valor}</p>
            <p className="text-xs text-muted-foreground">{metrica.detalle}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Por etapa" description="Cuántos negocios llegaron a cada etapa y cuántos están hoy en ella.">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2 font-medium">Etapa</th><th className="px-3 py-2 font-medium text-right">Llegaron</th><th className="px-3 py-2 font-medium text-right">Hoy</th><th className="px-4 py-2 font-medium text-right">Monto hoy</th></tr></thead>
            <tbody className="divide-y divide-border">
              {etapas.map((etapa) => {
                const hoy = abiertos.filter((negocio) => negocio.stage_id === etapa.id);
                return (
                  <tr key={etapa.id}>
                    <td className="px-4 py-2 text-foreground">{etapa.name}{etapa.probability !== null && !etapa.is_won && !etapa.is_lost ? <span className="text-xs text-muted-foreground"> · {etapa.probability}%</span> : null}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{alcanzaron.get(etapa.id)?.size ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{etapa.is_won ? ganados.length : etapa.is_lost ? cerrados.length - ganados.length : hoy.length}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{pesos.format(hoy.reduce((total, negocio) => total + monto(negocio), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Por origen" description="De dónde llegan los negocios y cuáles se cierran.">
          {porOrigen.length === 0 ? <EmptyState title="Sin datos" description="Aparece cuando haya negocios." /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2 font-medium">Origen</th><th className="px-3 py-2 font-medium text-right">Total</th><th className="px-3 py-2 font-medium text-right">Abiertos</th><th className="px-3 py-2 font-medium text-right">Ganados</th><th className="px-3 py-2 font-medium text-right">Tasa</th><th className="px-4 py-2 font-medium text-right">Monto ganado</th></tr></thead>
              <tbody className="divide-y divide-border">
                {porOrigen.map((fila) => (
                  <tr key={fila.origen}><td className="px-4 py-2 text-foreground">{ORIGEN[fila.origen] ?? fila.origen}</td><td className="px-3 py-2 text-right tabular-nums">{fila.total}</td><td className="px-3 py-2 text-right tabular-nums">{fila.abiertos}</td><td className="px-3 py-2 text-right tabular-nums">{fila.ganados}</td><td className="px-3 py-2 text-right tabular-nums">{fila.tasa === null ? "—" : `${fila.tasa}%`}</td><td className="px-4 py-2 text-right tabular-nums">{pesos.format(fila.monto)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
        <SectionCard title="Por responsable" description="Carga abierta y cierres de cada persona.">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2 font-medium">Responsable</th><th className="px-3 py-2 font-medium text-right">Abiertos</th><th className="px-3 py-2 font-medium text-right">Ganados</th><th className="px-4 py-2 font-medium text-right">Monto ganado</th></tr></thead>
            <tbody className="divide-y divide-border">
              {porResponsable.map((fila) => (
                <tr key={fila.nombre}><td className="px-4 py-2 text-foreground">{fila.nombre}</td><td className="px-3 py-2 text-right tabular-nums">{fila.abiertos}</td><td className="px-3 py-2 text-right tabular-nums">{fila.ganados}</td><td className="px-4 py-2 text-right tabular-nums">{pesos.format(fila.monto)}</td></tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Seguimiento automático de propuestas" description="Una propuesta o negociación sin avance hace más de 7 días recibe un correo de seguimiento, una vez por semana, por el puente con Atlas Lead. Le escribe a clientes reales: por eso nace apagado.">
          <div className="space-y-3 px-4 py-4">
            <Callout tone={seguimientoActivo ? "success" : "info"}>
              <p className="font-medium">{seguimientoActivo ? "Activo" : "Apagado"}</p>
              <p>{seguimientoActivo ? "Los seguimientos se programan solos y aparecen en la historia de cada negocio." : "Nadie recibe correos automáticos hasta que lo actives."}</p>
            </Callout>
            {profile.role === "admin" && (
              <form action={alternarSeguimientoAutomatico}>
                <input type="hidden" name="activo" value={seguimientoActivo ? "no" : "si"} />
                <SubmitButton variant={seguimientoActivo ? "secondary" : "primary"} pendingLabel="…">{seguimientoActivo ? "Apagar" : "Activar"}</SubmitButton>
              </form>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
