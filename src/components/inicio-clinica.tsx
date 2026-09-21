import Link from "next/link";
import { CalendarClock, MessageCircle, Plus, UserPlus } from "lucide-react";

import { Badge, EmptyState, MetricCard, PageHeader, SectionCard, buttonClasses } from "@/components/ui";
import { VENTAS_POR_EDICION, type Edicion } from "@/lib/ediciones";
import { REPORT_TIME_ZONE } from "@/lib/report-range";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Inicio de una clínica (Dental o Vet).
 *
 * Una clínica no opera colas ni discador: vive de presupuestos que se aceptan
 * o se enfrían. Lo primero que tiene que ver quien abre Atlas es a quién hay que
 * llamar hoy, cuánto hay en juego y qué presupuestos llevan días sin respuesta
 * (las alertas de 7, 15 y 30 días). Todo se calcula en vivo desde los mismos
 * presupuestos que muestra la pantalla de Presupuestos.
 */

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const compacto = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const DIA = 24 * 60 * 60 * 1000;

type Negocio = {
  id: string;
  name: string;
  status: "abierta" | "ganada" | "perdida";
  monthly_amount: number | null;
  one_time_amount: number | null;
  next_action_at: string | null;
  next_action_note: string | null;
  created_at: string;
  closed_at: string | null;
  source: string | null;
  owner_id: string | null;
  sales_companies: { name: string; metadata: Record<string, unknown> | null } | { name: string; metadata: Record<string, unknown> | null }[] | null;
};

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

/** Medianoche de hoy en Chile, como instante. */
function inicioDeHoyEnChile(ahora: Date): Date {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(ahora);
  const mediodia = new Date(`${partes}T12:00:00Z`);
  const desfase = mediodia.getTime() - new Date(mediodia.toLocaleString("en-US", { timeZone: REPORT_TIME_ZONE })).getTime();
  return new Date(new Date(`${partes}T00:00:00Z`).getTime() + desfase);
}

/** Las alertas de la clínica: 7, 15 y 30 días sin respuesta. */
function alerta(dias: number): { tono: "neutral" | "warning" | "danger"; texto: string } {
  if (dias >= 30) return { tono: "danger", texto: `${dias} días sin respuesta` };
  if (dias >= 15) return { tono: "danger", texto: `${dias} días` };
  if (dias >= 7) return { tono: "warning", texto: `${dias} días` };
  return { tono: "neutral", texto: dias <= 0 ? "hoy" : `${dias} ${dias === 1 ? "día" : "días"}` };
}

export async function InicioClinica({
  profile,
  edicion,
  empresa,
  leeConversaciones,
}: {
  profile: Profile;
  edicion: Exclude<Edicion, "center">;
  empresa: string | null;
  leeConversaciones: boolean;
}) {
  const supabase = await createClient();
  const voc = VENTAS_POR_EDICION[edicion];
  const mensual = voc.monto === "mensual";
  const soloMios = profile.role === "agente";
  const ahora = new Date();
  const hoy = inicioDeHoyEnChile(ahora);
  const finDeHoy = new Date(hoy.getTime() + DIA);
  const inicioDeMes = inicioDeHoyEnChile(new Date(ahora.getFullYear(), ahora.getMonth(), 1, 12));

  let negociosQuery = supabase
    .from("sales_opportunities")
    .select("id, name, status, monthly_amount, one_time_amount, next_action_at, next_action_note, created_at, closed_at, source, owner_id, sales_companies(name, metadata)")
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (soloMios) negociosQuery = negociosQuery.eq("owner_id", profile.id);

  const [{ data: negociosData, error }, { data: actividades }, { data: personas }, { data: conversaciones }] = await Promise.all([
    negociosQuery,
    supabase.from("sales_activities").select("opportunity_id, occurred_at").not("opportunity_id", "is", null).order("occurred_at", { ascending: false }).limit(4000),
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase.from("whatsapp_conversations").select("status, last_inbound_at, last_outbound_at").neq("status", "closed").limit(500),
  ]);

  const negocios = (negociosData ?? []) as Negocio[];
  const monto = (negocio: Negocio) => Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const nombre = new Map((personas ?? []).map((persona) => [persona.id as string, persona.full_name as string]));

  // Última vez que alguien movió cada presupuesto: de ahí salen los días sin respuesta.
  const ultimaActividad = new Map<string, number>();
  for (const actividad of actividades ?? []) {
    const id = actividad.opportunity_id as string;
    if (!ultimaActividad.has(id)) ultimaActividad.set(id, new Date(actividad.occurred_at as string).getTime());
  }
  const diasSinRespuesta = (negocio: Negocio) =>
    Math.floor((ahora.getTime() - (ultimaActividad.get(negocio.id) ?? new Date(negocio.created_at).getTime())) / DIA);

  const abiertos = negocios.filter((negocio) => negocio.status === "abierta");
  const enJuego = abiertos.reduce((total, negocio) => total + monto(negocio), 0);
  const aceptadosMes = negocios.filter((negocio) => negocio.status === "ganada" && negocio.closed_at && new Date(negocio.closed_at) >= inicioDeMes);
  const montoMes = aceptadosMes.reduce((total, negocio) => total + monto(negocio), 0);

  const hace90 = ahora.getTime() - 90 * DIA;
  const cerrados90 = negocios.filter((negocio) => negocio.status !== "abierta" && negocio.closed_at && new Date(negocio.closed_at).getTime() >= hace90);
  const ganados90 = cerrados90.filter((negocio) => negocio.status === "ganada").length;
  const tasa = cerrados90.length > 0 ? Math.round((ganados90 / cerrados90.length) * 100) : null;

  const paraHoy = abiertos
    .filter((negocio) => negocio.next_action_at && new Date(negocio.next_action_at) < finDeHoy)
    .sort((a, b) => diasSinRespuesta(b) - diasSinRespuesta(a));
  const vencidos = paraHoy.filter((negocio) => new Date(negocio.next_action_at as string) < hoy).length;

  const tramos = [
    { etiqueta: "Menos de 7 días", desde: 0, hasta: 6, clase: "bg-primary" },
    { etiqueta: "7 a 14 días", desde: 7, hasta: 14, clase: "bg-warning" },
    { etiqueta: "15 a 29 días", desde: 15, hasta: 29, clase: "bg-danger/70" },
    { etiqueta: "30 días o más", desde: 30, hasta: Infinity, clase: "bg-danger" },
  ].map((tramo) => {
    const casos = abiertos.filter((negocio) => {
      const dias = diasSinRespuesta(negocio);
      return dias >= tramo.desde && dias <= tramo.hasta;
    });
    return { ...tramo, total: casos.length, monto: casos.reduce((suma, negocio) => suma + monto(negocio), 0) };
  });
  const mayorTramo = Math.max(1, ...tramos.map((tramo) => tramo.total));

  // Conversión por profesional y por origen: solo lo ya decidido cuenta.
  function agrupar(clave: (negocio: Negocio) => string) {
    const grupos = new Map<string, { total: number; ganados: number; decididos: number; monto: number }>();
    for (const negocio of negocios) {
      const llave = clave(negocio);
      const grupo = grupos.get(llave) ?? { total: 0, ganados: 0, decididos: 0, monto: 0 };
      grupo.total += 1;
      if (negocio.status !== "abierta") grupo.decididos += 1;
      if (negocio.status === "ganada") {
        grupo.ganados += 1;
        grupo.monto += monto(negocio);
      }
      grupos.set(llave, grupo);
    }
    return [...grupos.entries()]
      .map(([llave, grupo]) => ({ llave, ...grupo, tasa: grupo.decididos > 0 ? Math.round((grupo.ganados / grupo.decididos) * 100) : null }))
      .sort((a, b) => b.monto - a.monto);
  }
  const porProfesional = agrupar((negocio) => {
    const valor = primero(negocio.sales_companies)?.metadata?.profesional;
    return typeof valor === "string" && valor ? valor : "Sin profesional";
  });
  const etiquetaOrigen = new Map(voc.origenes.map((origen) => [origen.value, origen.label]));
  const porOrigen = agrupar((negocio) => etiquetaOrigen.get(negocio.source ?? "") ?? "Sin origen");

  const abiertas = (conversaciones ?? []).length;
  const esperando = (conversaciones ?? []).filter(
    (conversacion) =>
      conversacion.last_inbound_at &&
      (!conversacion.last_outbound_at || new Date(conversacion.last_inbound_at as string) > new Date(conversacion.last_outbound_at as string)),
  ).length;

  const primerNombre = profile.full_name.split(" ")[0] ?? profile.full_name;
  const negocioMinuscula = voc.negocio.toLowerCase();
  const negociosMinuscula = voc.negocios.toLowerCase();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hola, ${primerNombre}`}
        description={`${empresa ?? "Tu clínica"} · ${fechaLarga.format(ahora)}${soloMios ? " · tus pacientes" : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/ventas" className={buttonClasses()}>
              <Plus size={16} aria-hidden="true" /> {voc.nuevo}
            </Link>
            {!soloMios && (
              <Link href="/dashboard/leads/nuevo" className={buttonClasses({ variant: "secondary" })}>
                <UserPlus size={16} aria-hidden="true" /> Nuevo {voc.cuenta.toLowerCase()}
              </Link>
            )}
          </div>
        }
      />

      {error && (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
          No se pudieron leer los {negociosMinuscula}. Vuelve a cargar para reintentar.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="En juego"
          value={pesos.format(enJuego)}
          hint={`${abiertos.length} ${abiertos.length === 1 ? `${negocioMinuscula} abierto` : `${negociosMinuscula} abiertos`}`}
          href="/dashboard/ventas"
          hrefLabel={`Ver ${negociosMinuscula}`}
        />
        <MetricCard
          label="Aceptado este mes"
          value={pesos.format(montoMes)}
          hint={`${aceptadosMes.length} ${aceptadosMes.length === 1 ? "aceptado" : "aceptados"}`}
          tone={montoMes > 0 ? "good" : "default"}
        />
        <MetricCard
          label="Tasa de aceptación"
          value={tasa === null ? "Sin datos" : `${tasa}%`}
          hint={`${ganados90} de ${cerrados90.length} decididos en 90 días`}
          progress={tasa ?? undefined}
          tone={tasa === null ? "default" : tasa >= 60 ? "good" : "warn"}
          tooltip={`De los ${negociosMinuscula} que se aceptaron o rechazaron en los últimos 90 días, cuántos se aceptaron.`}
        />
        <MetricCard
          label="Para llamar hoy"
          value={paraHoy.length}
          hint={vencidos > 0 ? `${vencidos} ya vencidos` : "al día"}
          tone={vencidos > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Hay que llamar hoy"
          description={`${voc.negocios} con la próxima acción vencida o para hoy, primero los que llevan más días sin respuesta.`}
        >
          {paraHoy.length === 0 ? (
            <EmptyState title="Nada pendiente para hoy" description={`Todos los ${negociosMinuscula} abiertos tienen su próxima acción más adelante.`} />
          ) : (
            <ul className="divide-y divide-border">
              {paraHoy.slice(0, 8).map((negocio) => {
                const cuenta = primero(negocio.sales_companies);
                const aviso = alerta(diasSinRespuesta(negocio));
                const cuando = new Date(negocio.next_action_at as string);
                return (
                  <li key={negocio.id}>
                    <Link href={`/dashboard/ventas/${negocio.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{cuenta?.name ?? "—"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {negocio.name}
                          {negocio.next_action_note ? ` · ${negocio.next_action_note}` : ""}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="text-sm font-medium tabular-nums text-foreground">{pesos.format(monto(negocio))}</p>
                        <p className="text-xs text-muted-foreground">
                          {cuando < hoy ? "Vencido" : `Hoy ${hora.format(cuando)}`}
                          {negocio.owner_id && nombre.get(negocio.owner_id) ? ` · ${nombre.get(negocio.owner_id)?.split(" ")[0]}` : ""}
                        </p>
                      </div>
                      <Badge tone={aviso.tono}>{aviso.texto}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {paraHoy.length > 8 && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Y {paraHoy.length - 8} más en{" "}
              <Link href="/dashboard/ventas" className="text-primary hover:underline">
                {negociosMinuscula}
              </Link>
              .
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Sin respuesta" description={`${voc.negocios} abiertos según los días desde el último contacto.`}>
            <div className="space-y-3 px-4 py-4">
              {tramos.map((tramo) => (
                <div key={tramo.etiqueta}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">{tramo.etiqueta}</span>
                    <span className="tabular-nums text-foreground">
                      <span className="font-semibold">{tramo.total}</span>
                      {tramo.monto > 0 && <span className="text-muted-foreground"> · {compacto.format(tramo.monto)}</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className={`h-full rounded-full ${tramo.clase}`} style={{ width: `${(tramo.total / mayorTramo) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="WhatsApp" description="Conversaciones con pacientes que siguen abiertas.">
            <div className="flex items-center gap-4 px-4 py-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-primary">
                <MessageCircle size={20} aria-hidden="true" />
              </div>
              <div className="flex-1 text-sm">
                <p className="text-foreground">
                  <span className="font-semibold tabular-nums">{abiertas}</span> abiertas
                </p>
                <p className={esperando > 0 ? "text-warning" : "text-muted-foreground"}>
                  {esperando} {esperando === 1 ? "espera" : "esperan"} respuesta
                </p>
              </div>
              {leeConversaciones && (
                <Link href="/dashboard/conversaciones" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  Abrir
                </Link>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Aceptación por profesional" description={`${voc.negocios} de cada profesional y cuánto se aceptó.`}>
          <TablaConversion filas={porProfesional} />
        </SectionCard>
        <SectionCard title="Por canal de origen" description="De dónde llegan los pacientes que aceptan.">
          <TablaConversion filas={porOrigen} />
        </SectionCard>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock size={13} aria-hidden="true" />
        Calculado al {ahora.toLocaleString("es-CL", { timeZone: REPORT_TIME_ZONE })} · hora de Chile
      </p>
    </div>
  );
}

function TablaConversion({
  filas,
}: {
  filas: { llave: string; total: number; ganados: number; tasa: number | null; monto: number }[];
}) {
  if (filas.length === 0) return <EmptyState title="Sin datos todavía" description="Aparece cuando haya presupuestos decididos." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="px-4 py-2 font-medium">Nombre</th>
          <th className="px-2 py-2 text-right font-medium">Total</th>
          <th className="px-2 py-2 text-right font-medium">Aceptación</th>
          <th className="px-4 py-2 text-right font-medium">Aceptado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {filas.map((fila) => (
          <tr key={fila.llave}>
            <td className="px-4 py-2.5 text-foreground">{fila.llave}</td>
            <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{fila.total}</td>
            <td className="px-2 py-2.5 text-right">
              {fila.tasa === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${fila.tasa}%` }} />
                  </div>
                  <span className="tabular-nums text-foreground">{fila.tasa}%</span>
                </div>
              )}
            </td>
            <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">{pesos.format(fila.monto)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
