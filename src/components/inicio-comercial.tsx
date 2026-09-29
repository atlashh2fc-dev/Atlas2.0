import Link from "next/link";
import { AlarmClock, AlertTriangle, BadgeDollarSign, CalendarCheck, Clock, FileClock, Handshake, Inbox, Mail, Plus, Trophy, UserX } from "lucide-react";

import { Badge, EmptyState, MetricCard, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
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

  const Fila = ({ negocio, detalle, tono }: { negocio: Negocio; detalle: string; tono?: "danger" | "warning" | "neutral" | "info" }) => (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Link href={`/dashboard/ventas/${negocio.id}`} className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
          {primero(negocio.sales_companies)?.name ?? negocio.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {negocio.name}{negocio.owner_id ? ` · ${nombres.get(negocio.owner_id) ?? ""}` : " · sin responsable"}{monto(negocio) > 0 ? ` · ${pesos.format(monto(negocio))}` : ""}
        </p>
      </div>
      <Badge tone={tono ?? "neutral"}>{detalle}</Badge>
    </li>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hola, ${profile.full_name.split(" ")[0]}`}
        description={`${empresa ?? "Tu empresa"} · ${fechaLarga.format(ahora)} · ${abiertos.length} ${abiertos.length === 1 ? "negocio abierto" : "negocios abiertos"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/ventas/prospeccion" className={buttonClasses()}>
              <Inbox size={16} aria-hidden="true" /> Por contactar
            </Link>
            <Link href="/dashboard/pipeline" className={buttonClasses({ variant: "secondary" })}>
              <Handshake size={16} aria-hidden="true" /> Negocios
            </Link>
            <Link href="/dashboard/ventas" className={buttonClasses({ variant: "secondary" })}>
              <Plus size={16} aria-hidden="true" /> {voc.nuevo}
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Por contactar", valor: porContactar.length, detalle: "Mostraron interés en la campaña", href: "/dashboard/ventas/prospeccion", icon: Inbox, iconTone: "teal" as const, tone: porContactar.length > 0 ? ("warn" as const) : ("good" as const) },
          { label: "Sin contactar", valor: sinContactar.length, detalle: "Negocios sin ninguna gestión", href: "/dashboard/pipeline?responsable=nadie", icon: UserX, iconTone: "blue" as const, tone: sinContactar.length > 0 ? ("warn" as const) : ("good" as const) },
          { label: "Vencidos", valor: vencidos.length, detalle: "Próxima acción pasada", href: "/dashboard/pipeline?vencidas=1", icon: AlarmClock, iconTone: "amber" as const, tone: vencidos.length > 0 ? ("danger" as const) : ("good" as const) },
          { label: "Hoy", valor: reunionesHoy.length, detalle: "Reuniones y acciones de hoy", href: "/dashboard/pipeline", icon: CalendarCheck, iconTone: "amber" as const, tone: "default" as const },
          { label: "En juego", valor: pesos.format(abiertos.reduce((total, negocio) => total + monto(negocio), 0)), detalle: `${mensual ? "mensual" : "único"} de lo abierto`, href: "/dashboard/pipeline", icon: BadgeDollarSign, iconTone: "green" as const, tone: "default" as const },
          { label: "Ganado este mes", valor: pesos.format(ganadosMes.reduce((total, negocio) => total + monto(negocio), 0)), detalle: `${ganadosMes.length} ${ganadosMes.length === 1 ? "negocio" : "negocios"}`, href: "/dashboard/pipeline", icon: Trophy, iconTone: "green" as const, tone: "default" as const },
        ].map((metrica) => (
          <MetricCard
            key={metrica.label}
            label={metrica.label}
            value={metrica.valor}
            hint={metrica.detalle}
            href={metrica.href}
            hrefLabel="Abrir"
            icon={metrica.icon}
            iconTone={metrica.iconTone}
            tone={metrica.tone}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={`Sin contactar · ${sinContactar.length}`} description="Llegaron y nadie los ha gestionado. Lo que viene de la web debería contactarse en menos de una hora." icon={UserX} tone="blue">
          {sinContactar.length === 0 ? <EmptyState icon={UserX} title="Todo contactado" description="Cada negocio abierto tiene al menos una gestión. Los que solo abrieron el correo están en Ventas › Por contactar." /> : (
            <ul className="divide-y divide-border">
              {sinContactar.slice(0, 10).map((negocio) => {
                const horas = horasDesde(negocio.created_at);
                return <Fila key={negocio.id} negocio={negocio} detalle={horas < 24 ? `${horas} h` : `${Math.floor(horas / 24)} d`} tono={negocio.source === "agenda_web" && horas >= 1 ? "danger" : horas >= 48 ? "warning" : "neutral"} />;
              })}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={`Vencidos · ${vencidos.length}`} description="Negocios con la próxima acción ya pasada, del más atrasado al más reciente." icon={AlarmClock} tone="amber">
          {vencidos.length === 0 ? <EmptyState icon={AlarmClock} title="Nada vencido" description="Todas las próximas acciones están al día." /> : (
            <ul className="divide-y divide-border">
              {vencidos.slice(0, 10).map((negocio) => (
                <Fila key={negocio.id} negocio={negocio} detalle={`${Math.floor((ahora.getTime() - new Date(negocio.next_action_at as string).getTime()) / DIA)} d`} tono="danger" />
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={`Hoy · ${reunionesHoy.length}`} description="Reuniones y acciones comprometidas para hoy, en orden." icon={CalendarCheck} tone="amber">
          {reunionesHoy.length === 0 ? <EmptyState icon={CalendarCheck} title="Sin compromisos hoy" description="Nada agendado para hoy." /> : (
            <ul className="divide-y divide-border">
              {reunionesHoy.map((negocio) => (
                <li key={negocio.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="inline-flex w-16 shrink-0 items-center gap-1 tabular-nums text-sm font-medium text-foreground"><Clock size={12} className="text-[var(--tone-amber)]" aria-hidden="true" />{hora.format(new Date(negocio.next_action_at as string))}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/ventas/${negocio.id}`} className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline">{primero(negocio.sales_companies)?.name ?? negocio.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">{negocio.next_action_note ?? negocio.name}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={`Propuestas sin respuesta · ${propuestasSinRespuesta.length}`} description="En propuesta o negociación con más de 7 días sin avance. Un mensaje corto suele destrabarlas." icon={FileClock} tone="green">
          {propuestasSinRespuesta.length === 0 ? <EmptyState icon={FileClock} title="Nada detenido" description="Ninguna propuesta lleva más de una semana sin respuesta." /> : (
            <ul className="divide-y divide-border">
              {propuestasSinRespuesta.slice(0, 10).map((negocio) => (
                <Fila key={negocio.id} negocio={negocio} detalle={`desde ${fechaCorta.format(new Date(negocio.next_action_at as string))}`} tono="warning" />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Campaña de correo" description="Lo que va enviando Atlas Lead: a cuántos les llegó, cuántos abrieron y cuántos hicieron clic." icon={Mail} tone="teal">
          {campanasCorreo.length === 0 ? <EmptyState icon={Mail} title="Sin campañas de correo" description="Cuando Atlas Lead envíe, el avance aparece acá." /> : (
            <ul className="divide-y divide-border">
              {campanasCorreo.map(([id, cuenta]) => (
                <li key={id} className="space-y-2 px-4 py-3">
                  <p className="truncate text-sm font-medium text-foreground">{nombreCampana.get(id) ?? "Campaña"}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded-lg border border-border border-l-2 border-l-border-strong bg-background px-3 py-2"><p className="text-lg font-semibold tabular-nums text-foreground">{cuenta.personas}</p><p className="text-muted-foreground">personas · {cuenta.correos} correos</p></div>
                    <div className="rounded-lg border border-border border-l-2 border-l-[var(--tone-teal)] bg-background px-3 py-2"><p className="text-lg font-semibold tabular-nums text-foreground">{cuenta.abrieron}</p><p className="text-muted-foreground">abrieron · {porciento(cuenta.abrieron, cuenta.personas)}</p></div>
                    <div className="rounded-lg border border-border border-l-2 border-l-success bg-background px-3 py-2"><p className="text-lg font-semibold tabular-nums text-success">{cuenta.clic}</p><p className="text-muted-foreground">hicieron clic · {porciento(cuenta.clic, cuenta.personas)}</p></div>
                    <div className={`rounded-lg border border-border border-l-2 bg-background px-3 py-2 ${cuenta.rebotes + cuenta.bajas > 0 ? "border-l-warning" : "border-l-border-strong"}`}><p className={`text-lg font-semibold tabular-nums ${cuenta.rebotes + cuenta.bajas > 0 ? "text-warning" : "text-foreground"}`}>{cuenta.rebotes + cuenta.bajas}</p><p className="text-muted-foreground">rebotes y bajas</p></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={`Por contactar · ${porContactar.length}`} description="Abrieron, hicieron clic o respondieron la campaña y esperan que les escribas. Los más calientes primero." icon={Inbox} tone="teal">
          {porContactar.length === 0 ? <EmptyState icon={Inbox} title="Bandeja al día" description="Nadie con interés espera gestión." /> : (
            <ul className="divide-y divide-border">
              {porContactar.slice(0, 8).map((p) => (
                <li key={p.lead_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{p.empresa ?? p.contacto ?? "Sin nombre"}</p>
                    <p className="truncate text-xs text-muted-foreground">{senalDe(p)} · {haceCuanto(p.ultima_senal_at, ahora)}</p>
                  </div>
                  <Badge tone={p.respondio || p.clic ? "success" : p.estado === "volvio" ? "warning" : "info"}>{p.estado === "nuevo" ? "Sin contactar" : p.estado === "volvio" ? "Volvió a abrir" : "Seguimiento"}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border px-4 py-2 text-xs"><Link href="/dashboard/ventas/prospeccion" className="text-primary hover:underline">Ver a quién escribirle</Link></p>
        </SectionCard>
      </div>
      {sinContactar.some((negocio) => negocio.source === "agenda_web" && horasDesde(negocio.created_at) >= 1) && (
        <p className="inline-flex items-center gap-2 text-xs text-danger"><AlertTriangle size={14} aria-hidden="true" /> Hay leads de la web con más de una hora sin contacto.</p>
      )}
    </div>
  );
}
