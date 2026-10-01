import Link from "next/link";
import { AlarmClock, AlertTriangle, BadgeDollarSign, CalendarCheck, ChevronRight, FileClock, Handshake, Inbox, LayoutDashboard, Mail, Plus, Trophy, UserX } from "lucide-react";

import { Avatar, Badge, EmptyState, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile, sumarDias } from "@/lib/citas";
import { VENTAS_POR_EDICION, type Edicion } from "@/lib/ediciones";
import { haceCuanto, senalDe, type Prospecto } from "@/lib/prospeccion";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * El "Hoy" de una empresa que vende B2B sin call center (Altius): lo que exige
 * acción ahora. Leads de la web sin contactar, seguimientos vencidos,
 * reuniones del día y propuestas sin respuesta. Todo con su enlace al
 * negocio y al pipeline.
 */

const DIA = 24 * 60 * 60 * 1000;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, weekday: "long", day: "numeric", month: "long" });
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit" });
const fechaCorta = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });

type Negocio = {
  id: string; name: string; status: string; monthly_amount: number | null; one_time_amount: number | null; next_action_at: string | null; next_action_note: string | null;
  stage_id: string; owner_id: string | null; source: string | null; created_at: string; closed_at: string | null;
  sales_companies: { name: string } | { name: string }[] | null; sales_stages: { key: string; name: string; is_won: boolean; is_lost: boolean } | { key: string; name: string; is_won: boolean; is_lost: boolean }[] | null;
};

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

export async function InicioComercial({ profile, edicion, empresa }: { profile: Profile; edicion: Edicion; empresa: string | null }) {
  const supabase = await createClient();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const inicioHoy = instanteEnChile(hoy, "00:00");
  const finHoy = instanteEnChile(sumarDias(hoy, 1), "00:00");
  const inicioMes = instanteEnChile(`${hoy.slice(0, 7)}-01`, "00:00");

  const [{ data: negociosData }, { data: actividades }, { data: personas }, { data: bandejaData }, { data: correoData }, { data: campanasData }] = await Promise.all([
    supabase
      .from("sales_opportunities")
      .select("id, name, status, monthly_amount, one_time_amount, next_action_at, next_action_note, stage_id, owner_id, source, created_at, closed_at, sales_companies(name), sales_stages(key, name, is_won, is_lost)")
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase.from("sales_activities").select("opportunity_id, kind, occurred_at").in("kind", ["llamada", "correo", "whatsapp", "reunion", "nota"]).order("occurred_at", { ascending: false }).limit(4000),
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase.rpc("bandeja_de_prospeccion", { p_dias: 14 }),
    supabase.from("lead_mail_status").select("campaign_id, sent_count, opened, clicked, bounced, unsubscribed").limit(5000),
    supabase.from("campaigns").select("id, name"),
  ]);
  const negocios = (negociosData ?? []) as unknown as Negocio[];
  const nombres = new Map((personas ?? []).map((persona) => [persona.id as string, persona.full_name as string]));
  const contactados = new Set((actividades ?? []).map((actividad) => actividad.opportunity_id as string));
  const monto = (negocio: Negocio) => Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const abiertos = negocios.filter((negocio) => negocio.status === "abierta");

  const sinContactar = abiertos.filter((negocio) => !contactados.has(negocio.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const vencidos = abiertos.filter((negocio) => negocio.next_action_at && new Date(negocio.next_action_at) < inicioHoy);
  const reunionesHoy = abiertos.filter((negocio) => negocio.next_action_at && new Date(negocio.next_action_at) >= inicioHoy && new Date(negocio.next_action_at) < finHoy);
  const propuestasSinRespuesta = abiertos.filter((negocio) => {
    const etapa = primero(negocio.sales_stages);
    return etapa && /propuesta|negociaci/i.test(etapa.name) && negocio.next_action_at && ahora.getTime() - new Date(negocio.next_action_at).getTime() > 7 * DIA;
  });
  // Quien abrió, hizo clic o respondió la campaña de correo: una señal, no un
  // negocio. Se trabaja en la bandeja de Prospección, ordenada por temperatura.
  const porContactar = ((bandejaData ?? []) as Prospecto[]).filter((p) => !p.no_contactar);
  const nombreCampana = new Map((campanasData ?? []).map((campana) => [campana.id as string, campana.name as string]));
  const porCampana = new Map<string, { personas: number; correos: number; abrieron: number; clic: number; rebotes: number; bajas: number }>();
  for (const fila of correoData ?? []) {
    const id = fila.campaign_id as string;
    const cuenta = porCampana.get(id) ?? { personas: 0, correos: 0, abrieron: 0, clic: 0, rebotes: 0, bajas: 0 };
    cuenta.personas += 1;
    cuenta.correos += Number(fila.sent_count ?? 0);
    if (fila.opened) cuenta.abrieron += 1;
    if (fila.clicked) cuenta.clic += 1;
    if (fila.bounced) cuenta.rebotes += 1;
    if (fila.unsubscribed) cuenta.bajas += 1;
    porCampana.set(id, cuenta);
  }
  const campanasCorreo = [...porCampana.entries()].sort((a, b) => b[1].personas - a[1].personas);
  const porciento = (parte: number, total: number) => (total > 0 ? `${Math.round((parte / total) * 100)} %` : "—");
  const ganadosMes =negocios.filter((negocio) => negocio.status === "ganada" && negocio.closed_at && new Date(negocio.closed_at) >= inicioMes);
  const horasDesde = (desde: string) => Math.floor((ahora.getTime() - new Date(desde).getTime()) / (60 * 60 * 1000));

  // Toda la fila abre el negocio: avatar de la empresa, nombre, detalle y
  // la señal de urgencia a la derecha.
  const Fila = ({ negocio, detalle, tono }: { negocio: Negocio; detalle: string; tono?: "danger" | "warning" | "neutral" | "info" }) => {
    const empresaNegocio = primero(negocio.sales_companies)?.name ?? negocio.name;
    return (
      <li>
        <Link
          href={`/dashboard/ventas/${negocio.id}`}
          className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Avatar name={empresaNegocio} shape="square" size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{empresaNegocio}</p>
            <p className="truncate text-xs text-muted-foreground">
              {negocio.name}{negocio.owner_id ? ` · ${nombres.get(negocio.owner_id) ?? ""}` : " · sin responsable"}{monto(negocio) > 0 ? ` · ${pesos.format(monto(negocio))}` : ""}
            </p>
          </div>
          <Badge tone={tono ?? "neutral"}>{detalle}</Badge>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
        </Link>
      </li>
    );
  };

  // Lo primero del día, en una frase: lo vencido antes que lo nuevo.
  const loPrimero =
    vencidos.length > 0
      ? `Lo primero: ${vencidos.length} ${vencidos.length === 1 ? "negocio vencido" : "negocios vencidos"}.`
      : sinContactar.length > 0
        ? `Lo primero: ${sinContactar.length} ${sinContactar.length === 1 ? "negocio sin contactar" : "negocios sin contactar"}.`
        : reunionesHoy.length > 0
          ? `Hoy tienes ${reunionesHoy.length} ${reunionesHoy.length === 1 ? "compromiso" : "compromisos"}.`
          : "Todo al día.";
  const conteo = (n: number) => (
    <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-foreground">{n}</span>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LayoutDashboard}
        title={`Hola, ${profile.full_name.split(" ")[0]}`}
        description={`${fechaLarga.format(ahora).replace(/^./, (letra) => letra.toUpperCase())}. ${loPrimero}`}
        meta={
          <>
            <span>{empresa ?? "Tu empresa"}</span>
            <span>{abiertos.length} {abiertos.length === 1 ? "negocio abierto" : "negocios abiertos"}</span>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/pipeline" className={buttonClasses({ variant: "secondary" })}>
              <Handshake size={16} aria-hidden="true" /> Negocios
            </Link>
            <Link href="/dashboard/ventas" className={buttonClasses({ variant: "secondary" })}>
              <Plus size={16} aria-hidden="true" /> {voc.nuevo}
            </Link>
            <Link href="/dashboard/ventas/prospeccion" className={buttonClasses()}>
              <Inbox size={16} aria-hidden="true" /> Por contactar
            </Link>
          </div>
        }
      />

      {/* Seis cifras en dos filas: lo que exige acción arriba, la plata abajo.
          El color solo aparece cuando hay algo que atender. */}
      <KpiStrip title="Tu día comercial" meta="Cada cifra abre su lista" columns={3}>
        <KpiStripItem label="Por contactar" icon={Inbox} value={porContactar.length.toLocaleString("es-CL")} tone={porContactar.length > 0 ? "warn" : "default"} detail="Mostraron interés en la campaña" href="/dashboard/ventas/prospeccion" />
        <KpiStripItem label="Sin contactar" icon={UserX} value={sinContactar.length.toLocaleString("es-CL")} tone={sinContactar.length > 0 ? "warn" : "default"} detail="Negocios sin ninguna gestión" href="/dashboard/pipeline?responsable=nadie" />
        <KpiStripItem label="Vencidos" icon={AlarmClock} value={vencidos.length.toLocaleString("es-CL")} tone={vencidos.length > 0 ? "danger" : "default"} detail="Próxima acción pasada" href="/dashboard/pipeline?vencidas=1" />
        <KpiStripItem label="Hoy" icon={CalendarCheck} value={reunionesHoy.length.toLocaleString("es-CL")} detail="Reuniones y acciones de hoy" href="/dashboard/pipeline" />
        <KpiStripItem label="En juego" icon={BadgeDollarSign} value={pesos.format(abiertos.reduce((total, negocio) => total + monto(negocio), 0))} detail={`${mensual ? "Mensual" : "Único"} de lo abierto`} href="/dashboard/pipeline" />
        <KpiStripItem label="Ganado este mes" icon={Trophy} value={pesos.format(ganadosMes.reduce((total, negocio) => total + monto(negocio), 0))} tone={ganadosMes.length > 0 ? "good" : "default"} detail={`${ganadosMes.length} ${ganadosMes.length === 1 ? "negocio" : "negocios"}`} href="/dashboard/pipeline" />
      </KpiStrip>

      {sinContactar.some((negocio) => negocio.source === "agenda_web" && horasDesde(negocio.created_at) >= 1) && (
        <p role="status" className="inline-flex items-center gap-2 text-xs font-medium text-danger"><AlertTriangle size={14} aria-hidden="true" /> Hay leads de la web con más de una hora sin contacto.</p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Vencidos" description="Negocios con la próxima acción ya pasada, del más atrasado al más reciente." actions={conteo(vencidos.length)}>
          {vencidos.length === 0 ? <EmptyState icon={AlarmClock} title="Nada vencido" description="Todas las próximas acciones están al día." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {vencidos.slice(0, 10).map((negocio) => (
                <Fila key={negocio.id} negocio={negocio} detalle={`${Math.floor((ahora.getTime() - new Date(negocio.next_action_at as string).getTime()) / DIA)} d`} tono="danger" />
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Sin contactar" description="Llegaron y nadie los ha gestionado. Lo que viene de la web debería contactarse en menos de una hora." actions={conteo(sinContactar.length)}>
          {sinContactar.length === 0 ? <EmptyState icon={UserX} title="Todo contactado" description="Cada negocio abierto tiene al menos una gestión. Los que solo abrieron el correo están en Ventas › Por contactar." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {sinContactar.slice(0, 10).map((negocio) => {
                const horas = horasDesde(negocio.created_at);
                return <Fila key={negocio.id} negocio={negocio} detalle={horas < 24 ? `${horas} h` : `${Math.floor(horas / 24)} d`} tono={negocio.source === "agenda_web" && horas >= 1 ? "danger" : horas >= 48 ? "warning" : "neutral"} />;
              })}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Hoy" description="Reuniones y acciones comprometidas para hoy, en orden." actions={conteo(reunionesHoy.length)}>
          {reunionesHoy.length === 0 ? <EmptyState icon={CalendarCheck} title="Sin compromisos hoy" description="Nada agendado para hoy." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {reunionesHoy.map((negocio) => {
                const empresaNegocio = primero(negocio.sales_companies)?.name ?? negocio.name;
                return (
                  <li key={negocio.id}>
                    <Link
                      href={`/dashboard/ventas/${negocio.id}`}
                      className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-foreground">{hora.format(new Date(negocio.next_action_at as string))}</span>
                      <Avatar name={empresaNegocio} shape="square" size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{empresaNegocio}</p>
                        <p className="truncate text-xs text-muted-foreground">{negocio.next_action_note ?? negocio.name}</p>
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Propuestas sin respuesta" description="En propuesta o negociación con más de 7 días sin avance. Un mensaje corto suele destrabarlas." actions={conteo(propuestasSinRespuesta.length)}>
          {propuestasSinRespuesta.length === 0 ? <EmptyState icon={FileClock} title="Nada detenido" description="Ninguna propuesta lleva más de una semana sin respuesta." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {propuestasSinRespuesta.slice(0, 10).map((negocio) => (
                <Fila key={negocio.id} negocio={negocio} detalle={`desde ${fechaCorta.format(new Date(negocio.next_action_at as string))}`} tono="warning" />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Por contactar" description="Abrieron, hicieron clic o respondieron la campaña y esperan que les escribas. Los más calientes primero." actions={conteo(porContactar.length)}>
          {porContactar.length === 0 ? <EmptyState icon={Inbox} title="Bandeja al día" description="Nadie con interés espera gestión." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {porContactar.slice(0, 8).map((p) => {
                const nombre = p.empresa ?? p.contacto ?? "Sin nombre";
                return (
                  <li key={p.lead_id} className="flex items-center gap-3 px-5 py-2.5">
                    <Avatar name={nombre} shape={p.empresa ? "square" : "circle"} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">{senalDe(p)} · {haceCuanto(p.ultima_senal_at, ahora)}</p>
                    </div>
                    <Badge tone={p.respondio || p.clic ? "success" : p.estado === "volvio" ? "warning" : "info"}>{p.estado === "nuevo" ? "Sin contactar" : p.estado === "volvio" ? "Volvió a abrir" : "Seguimiento"}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border bg-surface-raised px-5 py-2.5 text-xs"><Link href="/dashboard/ventas/prospeccion" className="font-medium text-primary hover:underline">Ver a quién escribirle</Link></p>
        </SectionCard>
        <SectionCard title="Campaña de correo" description="Lo que va enviando Atlas Lead: a cuántos les llegó, cuántos abrieron y cuántos hicieron clic.">
          {campanasCorreo.length === 0 ? <EmptyState icon={Mail} title="Sin campañas de correo" description="Cuando Atlas Lead envíe, el avance aparece acá." /> : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {campanasCorreo.map(([id, cuenta]) => {
                const nombre = nombreCampana.get(id) ?? "Campaña";
                const problemas = cuenta.rebotes + cuenta.bajas;
                return (
                  <li key={id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={nombre} seed={id} shape="square" size="sm" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{nombre}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">{cuenta.correos.toLocaleString("es-CL")} correos</span>
                    </div>
                    {/* Embudo de la campaña en una franja dividida: cifras
                        alineadas, color solo en el clic y en los problemas. */}
                    <dl className="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                      <div className="bg-surface px-3 py-2">
                        <dt className="text-[11px] text-muted-foreground">Personas</dt>
                        <dd className="text-base font-semibold tabular-nums text-foreground">{cuenta.personas.toLocaleString("es-CL")}</dd>
                      </div>
                      <div className="bg-surface px-3 py-2">
                        <dt className="text-[11px] text-muted-foreground">Abrieron · {porciento(cuenta.abrieron, cuenta.personas)}</dt>
                        <dd className="text-base font-semibold tabular-nums text-foreground">{cuenta.abrieron.toLocaleString("es-CL")}</dd>
                      </div>
                      <div className="bg-surface px-3 py-2">
                        <dt className="text-[11px] text-muted-foreground">Clic · {porciento(cuenta.clic, cuenta.personas)}</dt>
                        <dd className={`text-base font-semibold tabular-nums ${cuenta.clic > 0 ? "text-success" : "text-foreground"}`}>{cuenta.clic.toLocaleString("es-CL")}</dd>
                      </div>
                      <div className="bg-surface px-3 py-2">
                        <dt className="text-[11px] text-muted-foreground">Rebotes y bajas</dt>
                        <dd className={`text-base font-semibold tabular-nums ${problemas > 0 ? "text-warning" : "text-foreground"}`}>{problemas.toLocaleString("es-CL")}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
