import { connection } from "next/server";
import { BadgeDollarSign, Compass, MailCheck, Percent, Timer, TrendingUp, Trophy, Users, XCircle } from "lucide-react";

import { alternarSeguimientoAutomatico } from "@/app/actions/pipeline";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Avatar, Badge, EmptyState, NavTabs, PageHeader, SectionCard, SubmitButton, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";
import { PESTANAS_VENTAS } from "@/lib/ventas-pestanas";

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
  await connection();
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

  const maxOrigen = Math.max(1, ...porOrigen.map((fila) => fila.total));
  const maxResponsable = Math.max(1, ...porResponsable.map((fila) => fila.abiertos + fila.ganados));

  return (
    <div className="space-y-5">
      <PageHeader title={voc.titulo} icon={TrendingUp} description={`${empresa ?? "Tu empresa"} · cuánto vendiste, de dónde llegan los negocios y quién los cierra`} />
      <NavTabs tabs={PESTANAS_VENTAS} />

      <KpiStrip columns={4}>
        <KpiStripItem
          label="Tasa de cierre"
          value={tasa === null ? "—" : `${tasa}%`}
          icon={Percent}
          detail={`${ganados.length} ganados de ${cerrados.length} cerrados`}
          progress={tasa ?? undefined}
          tone={tasa !== null && tasa > 0 ? "good" : "default"}
        />
        <KpiStripItem label="Días hasta cerrar" value={promedioCierre === null ? "—" : `${promedioCierre} d`} icon={Timer} detail="Promedio de los ganados" />
        <KpiStripItem
          label="En juego"
          value={pesos.format(abiertos.reduce((total, negocio) => total + monto(negocio), 0))}
          icon={BadgeDollarSign}
          detail={`${pesos.format(ponderado)} ponderado por etapa`}
        />
        <KpiStripItem
          label="Seguimientos automáticos"
          value={seguimientosEnviados.toLocaleString("es-CL")}
          icon={MailCheck}
          detail={`${seguimientosRespondidos} respondidos · ${seguimientoActivo ? "activo" : "apagado"}`}
        />
      </KpiStrip>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Por etapa" description="Cuántos negocios llegaron a cada etapa y cuántos están hoy en ella.">
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Etapa</Th>
                <Th align="right">Llegaron</Th>
                <Th align="right">Hoy</Th>
                <Th align="right">Monto hoy</Th>
              </Thead>
              <Tbody>
                {etapas.map((etapa, indice) => {
                  const hoy = abiertos.filter((negocio) => negocio.stage_id === etapa.id);
                  const enEtapa = etapa.is_won ? ganados.length : etapa.is_lost ? cerrados.length - ganados.length : hoy.length;
                  const montoHoy = hoy.reduce((total, negocio) => total + monto(negocio), 0);
                  return (
                    <Tr key={etapa.id}>
                      <Td>
                        <span className="flex items-center gap-2.5">
                          <span
                            className="icon-chip size-6 rounded-md text-[10px] font-semibold tabular-nums"
                            data-tone={etapa.is_won ? "green" : etapa.is_lost ? "rose" : "slate"}
                            aria-hidden="true"
                          >
                            {etapa.is_won ? <Trophy size={12} /> : etapa.is_lost ? <XCircle size={12} /> : indice + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{etapa.name}</span>
                            {etapa.probability !== null && !etapa.is_won && !etapa.is_lost && (
                              <span className="block text-xs text-muted-foreground">{etapa.probability}% de cierre</span>
                            )}
                          </span>
                        </span>
                      </Td>
                      <Td align="right" muted>{alcanzaron.get(etapa.id)?.size ?? 0}</Td>
                      <Td align="right" strong>{enEtapa}</Td>
                      <Td align="right" className={montoHoy > 0 ? "text-foreground" : "text-muted-foreground"}>{pesos.format(montoHoy)}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title="Por origen" description="De dónde llegan los negocios y cuáles se cierran.">
          {porOrigen.length === 0 ? (
            <EmptyState icon={Compass} title="Sin datos" description="Aparece cuando haya negocios." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Th>Origen</Th>
                  <Th align="right">Abiertos</Th>
                  <Th align="right">Ganados</Th>
                  <Th align="right">Tasa</Th>
                  <Th align="right">Monto ganado</Th>
                </Thead>
                <Tbody>
                  {porOrigen.map((fila) => (
                    <Tr key={fila.origen}>
                      <Td>
                        <span className="block min-w-32">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="font-medium text-foreground">{ORIGEN[fila.origen] ?? fila.origen}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">{fila.total}</span>
                          </span>
                          {/* Cuánto pesa cada origen frente al mayor, sin un gráfico aparte. */}
                          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-muted">
                            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(fila.total / maxOrigen) * 100}%` }} />
                          </span>
                        </span>
                      </Td>
                      <Td align="right" muted>{fila.abiertos}</Td>
                      <Td align="right">{fila.ganados}</Td>
                      <Td align="right" className={fila.tasa ? "font-medium text-success" : "text-muted-foreground"}>{fila.tasa === null ? "—" : `${fila.tasa}%`}</Td>
                      <Td align="right" className={fila.monto > 0 ? "text-foreground" : "text-muted-foreground"}>{pesos.format(fila.monto)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Por responsable" description="Carga abierta y cierres de cada persona.">
          {porResponsable.length === 0 ? (
            <EmptyState icon={Users} title="Sin datos" description="Aparece cuando haya negocios con responsable." />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {porResponsable.map((fila) => (
                <li key={fila.nombre} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={fila.nombre} size="sm" tone={fila.nombre === "Sin responsable" ? "slate" : undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{fila.nombre}</p>
                    <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <span className="h-full bg-success/80" style={{ width: `${(fila.ganados / maxResponsable) * 100}%` }} />
                      <span className="h-full bg-primary/50" style={{ width: `${(fila.abiertos / maxResponsable) * 100}%` }} />
                    </div>
                  </div>
                  <dl className="flex shrink-0 gap-4 text-right">
                    <div className="w-14">
                      <dt className="text-[10px] text-muted-foreground">Abiertos</dt>
                      <dd className="text-[13px] tabular-nums text-foreground">{fila.abiertos}</dd>
                    </div>
                    <div className="w-14">
                      <dt className="text-[10px] text-muted-foreground">Ganados</dt>
                      <dd className={`text-[13px] tabular-nums ${fila.ganados > 0 ? "font-semibold text-success" : "text-foreground"}`}>{fila.ganados}</dd>
                    </div>
                    <div className="hidden w-24 sm:block">
                      <dt className="text-[10px] text-muted-foreground">Monto ganado</dt>
                      <dd className="text-[13px] font-medium tabular-nums text-foreground">{pesos.format(fila.monto)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Seguimiento automático de propuestas" description="Una propuesta o negociación sin avance hace más de 7 días recibe un correo de seguimiento, una vez por semana, por el puente con Atlas Lead. Le escribe a clientes reales: por eso nace apagado.">
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="icon-chip mt-0.5 size-8 rounded-lg" data-tone={seguimientoActivo ? "green" : "slate"} aria-hidden="true">
                <MailCheck size={15} />
              </span>
              <div className="min-w-0">
                <Badge tone={seguimientoActivo ? "success" : "neutral"} dot>{seguimientoActivo ? "Activo" : "Apagado"}</Badge>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {seguimientoActivo ? "Los seguimientos se programan solos y aparecen en la historia de cada negocio." : "Nadie recibe correos automáticos hasta que lo actives."}
                </p>
              </div>
            </div>
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
