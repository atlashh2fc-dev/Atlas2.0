import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ClipboardCheck, ExternalLink, Inbox, Mail, Send } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CorreoRegistroPanel, type CorreoEnviado, type CorreoRecibido } from "@/components/correo-registro-panel";
import { OPEN_CALL_FORM_ATTRIBUTE } from "@/lib/call-management-navigation";
import { desglosePorProducto, lineasGuardadas, montoLinea } from "@/lib/equifax-cotizador/catalogo";
import { contextoDeTipificacion } from "@/lib/tipificacion-contexto.server";
import { EsperaDelCliente, RefrescoDeBandeja, TipificarCorreo } from "@/components/puesto-correo";
import { Avatar, Badge, buttonClasses, EmptyState, SectionCard, SegmentTabs, type BadgeTone, type SegmentTab } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pestaña de correo del puesto de atención.
 *
 * Para el ejecutivo es su bandeja: los clientes cuyo correo le asignó la cola
 * (o que son suyos por agenda, propuesta o registro), el hilo al centro y el
 * cliente al lado, como el WhatsApp. Se responde por el buzón de la cuenta y
 * se cierra con la tipificación de siempre. En «Enviados» repasa lo que él
 * mismo mandó por correo: propuestas y respuestas, con su estado.
 *
 * Para supervisión sigue siendo la entrada a los buzones: el de la cuenta se
 * supervisa como cola en Correo › Buzón, y los de campaña en su campaña.
 */
export default async function MailAttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ registro?: string; vista?: string; envio?: string }>;
}) {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  if (profile.role !== "agente") return <BuzonesDeSupervision />;
  return <BandejaDelEjecutivo profileId={profile.id} params={await searchParams} />;
}

const SLA_POR_DEFECTO = 4 * 60 * 60;
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const diaChile = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" });
const horaChile = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short" });

/** "09:27" si fue hoy, "Ayer" y después la fecha corta, como cualquier bandeja. */
function horaRelativa(valor: string, ahora: Date) {
  const fecha = new Date(valor);
  const minutos = Math.floor((ahora.getTime() - fecha.getTime()) / 60_000);
  if (minutos < 1) return "Ahora";
  if (minutos < 60) return `${minutos} min`;
  const dia = diaChile.format(fecha);
  if (dia === diaChile.format(ahora)) return horaChile.format(fecha);
  if (dia === diaChile.format(new Date(ahora.getTime() - 86_400_000))) return "Ayer";
  return diaCorto.format(fecha);
}

/** "VOLVER A LLAMAR" → "Volver a llamar": lo que llega en mayúsculas desde la base. */
function enOracion(texto: string) {
  if (texto !== texto.toUpperCase()) return texto;
  const minusculas = texto.toLocaleLowerCase("es-CL");
  return minusculas.charAt(0).toLocaleUpperCase("es-CL") + minusculas.slice(1);
}

type Relacion<T> = T | T[] | null;
function uno<T>(valor: Relacion<T>): T | null {
  return Array.isArray(valor) ? valor[0] ?? null : valor;
}

type FilaCorreo = {
  id: string;
  lead_id: string;
  from_name: string | null;
  from_address: string;
  subject: string;
  preview: string | null;
  received_at: string;
  status: "new" | "converted";
  primera_respuesta_at: string | null;
  contact_center_queues: Relacion<{ sla_correo_segundos: number }>;
  leads: Relacion<{
    full_name: string | null;
    rut: string | null;
    phone: string | null;
    email: string | null;
    tipificacion_actual: string | null;
    next_action_at: string | null;
    campaigns: Relacion<{ name: string }>;
  }>;
};

type Conversacion = {
  leadId: string;
  nombre: string;
  asunto: string;
  vistaPrevia: string;
  ultimo: string;
  pendientes: number;
  /** Desde cuándo espera respuesta; nulo si ya se le contestó. */
  esperaDesde: string | null;
  sla: number;
};

function conversaciones(filas: FilaCorreo[]): Conversacion[] {
  const porRegistro = new Map<string, Conversacion>();
  for (const fila of filas) {
    const lead = uno(fila.leads);
    const actual = porRegistro.get(fila.lead_id) ?? {
      leadId: fila.lead_id,
      nombre: lead?.full_name || fila.from_name || fila.from_address,
      asunto: fila.subject,
      vistaPrevia: fila.preview ?? "",
      ultimo: fila.received_at,
      pendientes: 0,
      esperaDesde: null,
      sla: uno(fila.contact_center_queues)?.sla_correo_segundos ?? SLA_POR_DEFECTO,
    };
    // Las filas vienen de la más nueva a la más vieja: la primera fija el asunto.
    if (fila.status === "new") {
      actual.pendientes += 1;
      if (!fila.primera_respuesta_at && (!actual.esperaDesde || fila.received_at < actual.esperaDesde)) {
        actual.esperaDesde = fila.received_at;
      }
    }
    porRegistro.set(fila.lead_id, actual);
  }
  return [...porRegistro.values()];
}

async function BandejaDelEjecutivo({ profileId, params }: { profileId: string; params: { registro?: string; vista?: string; envio?: string } }) {
  const supabase = await createClient();
  const vista = params.vista === "atendidos" || params.vista === "enviados" ? params.vista : "pendientes";
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("inbound_emails")
    .select(
      "id, lead_id, from_name, from_address, subject, preview, received_at, status, primera_respuesta_at, contact_center_queues(sla_correo_segundos), leads(full_name, rut, phone, email, tipificacion_actual, next_action_at, campaigns!leads_campaign_id_fkey(name))",
    )
    .eq("assigned_to", profileId)
    .not("lead_id", "is", null)
    .gte("received_at", desde)
    .order("received_at", { ascending: false })
    .limit(300);

  const todas = conversaciones((data ?? []) as unknown as FilaCorreo[]);
  // Por atender: primero quien lleva más esperando, como una cola de verdad.
  const porAtender = todas
    .filter((c) => c.pendientes > 0)
    .sort((a, b) => (a.esperaDesde ?? a.ultimo).localeCompare(b.esperaDesde ?? b.ultimo));
  const atendidos = todas.filter((c) => c.pendientes === 0).sort((a, b) => b.ultimo.localeCompare(a.ultimo));
  const lista = vista === "atendidos" ? atendidos : porAtender;
  const elegida = todas.find((c) => c.leadId === params.registro) ?? lista[0] ?? null;

  // Solo la cola por atender lleva cifra: es la que pide acción, y con tres
  // pestañas en la columna de 20rem no caben tres conteos.
  const pestanas: SegmentTab[] = [
    { id: "pendientes", label: "Por atender", href: "/dashboard/conversaciones/correo?vista=pendientes", count: porAtender.length },
    { id: "atendidos", label: "Atendidos", href: "/dashboard/conversaciones/correo?vista=atendidos" },
    { id: "enviados", label: "Enviados", href: "/dashboard/conversaciones/correo?vista=enviados" },
  ];

  if (vista === "enviados") return <EnviadosDelEjecutivo profileId={profileId} envio={params.envio} pestanas={pestanas} />;

  if (todas.length === 0) {
    return (
      <>
        {error && <p role="alert" className="text-sm text-danger">No se pudo leer tu correo: {error.message}</p>}
        <EmptyState
          icon={Inbox}
          title="Sin correos de clientes"
          description="Cuando un cliente responda al buzón de tu campaña, o la cola te entregue una conversación, aparece acá. Si no quieres recibir correo nuevo, apágalo en tu estado, arriba."
          action={
            <Link href="/dashboard/conversaciones/correo?vista=enviados" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <Send size={14} aria-hidden="true" /> Ver los correos que enviaste
            </Link>
          }
        />
        <RefrescoDeBandeja />
      </>
    );
  }

  const [{ data: recibidosData }, { data: enviadosData }, { data: fichaData }] = elegida
    ? await Promise.all([
        supabase
          .from("inbound_emails")
          .select("id, from_name, from_address, subject, body_text, received_at, status, asignacion, profiles!inbound_emails_assigned_to_fkey(full_name)")
          .eq("lead_id", elegida.leadId)
          .order("received_at", { ascending: true })
          .limit(30),
        supabase
          .from("correos_de_registro")
          .select("id, respuesta_a, destinatario, asunto, cuerpo, estado, error, created_at, profiles!correos_de_registro_agent_id_fkey(full_name)")
          .eq("lead_id", elegida.leadId)
          .order("created_at", { ascending: true })
          .limit(30),
        supabase
          .from("leads")
          .select("full_name, rut, phone, email, tipificacion_actual, observacion_actual, next_action_at, campaigns!leads_campaign_id_fkey(name)")
          .eq("id", elegida.leadId)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  // La conversación se tipifica acá mismo: si hay una gestión abierta de este
  // cliente, el formulario de siempre aparece sobre el hilo.
  const gestion = elegida ? await getOpenCall(elegida.leadId).catch(() => null) : null;
  const tipificacion = gestion && elegida ? await contextoDeTipificacion(supabase, elegida.leadId) : null;

  const ficha = fichaData as {
    full_name: string | null;
    rut: string | null;
    phone: string | null;
    email: string | null;
    tipificacion_actual: string | null;
    observacion_actual: string | null;
    next_action_at: string | null;
    campaigns: Relacion<{ name: string }>;
  } | null;
  const hrefDe = (leadId: string) => `/dashboard/conversaciones/correo?${new URLSearchParams({ vista, registro: leadId })}`;
  const nombreCliente = ficha?.full_name ?? elegida?.nombre ?? "";
  const datosCliente: [string, string | null | undefined][] = [
    ["Campaña", uno(ficha?.campaigns ?? null)?.name],
    ["RUT", ficha?.rut],
    ["Teléfono", ficha?.phone],
    ["Correo", ficha?.email],
    ["Última tipificación", ficha?.tipificacion_actual ? enOracion(ficha.tipificacion_actual) : null],
    ["Próxima acción", ficha?.next_action_at ? cuando.format(new Date(ficha.next_action_at)) : null],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_18rem]">
      <RefrescoDeBandeja />

      <nav aria-label="Conversaciones de correo" className="atlas-panel min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {/* Por atender y Atendidos como pestañas pegadas a la lista. */}
        <div className="border-b border-border px-2">
          <SegmentTabs tabs={pestanas} activeId={vista} label="Qué conversaciones ver" />
        </div>
        {lista.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {vista === "pendientes" ? "Estás al día: ningún cliente espera respuesta." : "Todavía no cierras conversaciones este mes."}
          </p>
        ) : (
          <ul className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
            {lista.map((c) => {
              const activa = c.leadId === elegida?.leadId;
              return (
                <li key={c.leadId}>
                  <Link
                    href={hrefDe(c.leadId)}
                    aria-current={activa ? "true" : undefined}
                    className={cn(
                      "flex gap-3 px-3.5 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      activa ? "bg-primary/[0.07]" : "hover:bg-surface-muted/60",
                    )}
                  >
                    <Avatar name={c.nombre} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[13px] text-foreground", c.pendientes > 0 ? "font-semibold" : "font-medium")}>{c.nombre}</span>
                        {!c.esperaDesde && (
                          <time dateTime={c.ultimo} title={cuando.format(new Date(c.ultimo))} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {horaRelativa(c.ultimo, ahora)}
                          </time>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-foreground/85">{c.asunto}</span>
                        {c.pendientes > 1 && (
                          <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary">{c.pendientes}</span>
                        )}
                      </span>
                      {c.vistaPrevia && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.vistaPrevia}</span>}
                      {c.esperaDesde && (
                        <span className="mt-1 block">
                          <EsperaDelCliente desde={c.esperaDesde} slaSegundos={c.sla} />
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <section aria-label="Conversación" className="min-w-0 space-y-4">
        {gestion && tipificacion && (
          <div
            id="gestion-en-curso"
            {...{ [OPEN_CALL_FORM_ATTRIBUTE]: gestion.id }}
            className="atlas-panel scroll-mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
          >
            <p className="flex items-center gap-2 border-b border-border bg-surface-raised px-5 py-3 text-[13px] font-semibold text-foreground">
              <ClipboardCheck size={15} className="text-primary" aria-hidden="true" />
              Tipificación de la conversación por correo
            </p>
            <div className="p-3 sm:p-5">
              <CallTypificationForm
                key={gestion.id}
                lead={tipificacion.lead}
                call={gestion}
                reasonCatalog={tipificacion.reasonCatalog}
                equifaxCommercialFieldsEnabled={tipificacion.equifaxCommercialFieldsEnabled}
                appointmentScheduleUrl={tipificacion.appointmentScheduleUrl}
                agendaPolicy={tipificacion.agendaPolicy}
                quoteClient={tipificacion.quoteClient}
                cotizador={tipificacion.cotizador}
              />
            </div>
          </div>
        )}
        {elegida ? (
          <CorreoRegistroPanel
            leadId={elegida.leadId}
            recibidos={(recibidosData ?? []) as unknown as CorreoRecibido[]}
            enviados={(enviadosData ?? []) as unknown as CorreoEnviado[]}
            puedeResponder
          />
        ) : (
          <EmptyState icon={Mail} title="Elige una conversación" description="A la izquierda están los clientes que esperan tu respuesta, del que lleva más esperando al más reciente." />
        )}
      </section>

      {elegida && (
        <aside aria-label="Cliente" className="atlas-panel min-w-0 self-start overflow-hidden rounded-xl border border-border bg-surface shadow-sm lg:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-3 border-b border-border/70 px-4 py-4">
            <Avatar name={nombreCliente} seed={ficha?.rut ?? nombreCliente} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-foreground">{nombreCliente}</p>
              <p className="truncate text-xs text-muted-foreground">{ficha?.email ?? "Cliente por correo"}</p>
            </div>
          </div>
          <dl className="space-y-2.5 px-4 py-4">
            {datosCliente
              .filter(([, valor]) => valor)
              .map(([etiqueta, valor]) => (
                <div key={etiqueta} className="flex items-start justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{etiqueta}</dt>
                  <dd className="min-w-0 break-words text-right font-medium text-foreground">{valor}</dd>
                </div>
              ))}
            {ficha?.observacion_actual && (
              <div className="pt-1 text-xs">
                <dt className="text-muted-foreground">Observación</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-muted/60 px-3 py-2 text-foreground">{ficha.observacion_actual}</dd>
              </div>
            )}
          </dl>
          <div className="space-y-2.5 border-t border-border/70 px-4 py-4">
            {!gestion && <TipificarCorreo leadId={elegida.leadId} pendiente={elegida.pendientes > 0} />}
            <Link href={`/dashboard/leads/${elegida.leadId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              Abrir la ficha completa <ExternalLink size={12} aria-hidden="true" />
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}

type Envio = {
  /** "p-<id>" para una propuesta, "r-<id>" para una respuesta: va en ?envio=. */
  clave: string;
  tipo: "propuesta" | "respuesta";
  id: string;
  leadId: string;
  cliente: string;
  destinatario: string;
  asunto: string;
  /** Lo que se mandó en una línea: los productos con su precio, o el asunto. */
  resumen: string;
  fecha: string;
  estado: "enviando" | "enviado" | "fallido";
  error: string | null;
  respondidaAt: string | null;
  cuerpo: string | null;
  lineas: unknown;
};

const ESTADO_ENVIO: Record<Envio["estado"], { texto: string; tono: BadgeTone }> = {
  enviando: { texto: "Enviando", tono: "warning" },
  enviado: { texto: "Enviado", tono: "neutral" },
  fallido: { texto: "No salió", tono: "danger" },
};

function EstadoDelEnvio({ envio }: { envio: Envio }) {
  if (envio.respondidaAt && envio.estado === "enviado") return <Badge tone="success">Respondió</Badge>;
  const { texto, tono } = ESTADO_ENVIO[envio.estado];
  return <Badge tone={tono}>{texto}</Badge>;
}

/** Cada producto de la propuesta como lo leyó el cliente, con su precio por separado. */
function lineasDeLaPropuesta(valor: unknown) {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((linea) => {
    const [monto] = lineasGuardadas([linea]);
    if (!monto) return [];
    const { nombre, detalle } = linea as Record<string, unknown>;
    return [{
      nombre: typeof nombre === "string" && nombre ? nombre : monto.nombre,
      detalle: typeof detalle === "string" && detalle ? detalle : null,
      monto: montoLinea(monto),
    }];
  });
}

/**
 * Lo que el ejecutivo mandó por correo desde Atlas: las propuestas del
 * cotizador y las respuestas a clientes. Sale todo del buzón de la cuenta, así
 * que no hay otra carpeta de enviados donde mirarlo.
 */
async function EnviadosDelEjecutivo({ profileId, envio, pestanas }: { profileId: string; envio?: string; pestanas: SegmentTab[] }) {
  const supabase = await createClient();
  const [propuestas, respuestas] = await Promise.all([
    supabase
      .from("equifax_cotizaciones")
      .select("id, lead_id, destinatario, asunto, lineas, estado, error, created_at, enviada_at, respondida_at, leads(full_name)")
      .eq("agent_id", profileId)
      .eq("canal", "correo")
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("correos_de_registro")
      .select("id, lead_id, destinatario, asunto, cuerpo, estado, error, created_at, enviado_at, leads(full_name)")
      .eq("agent_id", profileId)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);
  const error = propuestas.error ?? respuestas.error;

  type Lead = Relacion<{ full_name: string | null }>;
  const envios: Envio[] = [
    ...((propuestas.data ?? []) as unknown as {
      id: string; lead_id: string; destinatario: string; asunto: string | null; lineas: unknown;
      estado: "enviando" | "enviada" | "fallida"; error: string | null; created_at: string;
      enviada_at: string | null; respondida_at: string | null; leads: Lead;
    }[]).map((fila): Envio => ({
      clave: `p-${fila.id}`,
      tipo: "propuesta",
      id: fila.id,
      leadId: fila.lead_id,
      cliente: uno(fila.leads)?.full_name || fila.destinatario,
      destinatario: fila.destinatario,
      asunto: fila.asunto ?? "Propuesta comercial",
      resumen: `Propuesta · ${desglosePorProducto(lineasGuardadas(fila.lineas))}`,
      fecha: fila.enviada_at ?? fila.created_at,
      estado: fila.estado === "enviada" ? "enviado" : fila.estado === "fallida" ? "fallido" : "enviando",
      error: fila.error,
      respondidaAt: fila.respondida_at,
      cuerpo: null,
      lineas: fila.lineas,
    })),
    ...((respuestas.data ?? []) as unknown as {
      id: string; lead_id: string; destinatario: string; asunto: string; cuerpo: string;
      estado: "enviando" | "enviado" | "fallido"; error: string | null; created_at: string;
      enviado_at: string | null; leads: Lead;
    }[]).map((fila): Envio => ({
      clave: `r-${fila.id}`,
      tipo: "respuesta",
      id: fila.id,
      leadId: fila.lead_id,
      cliente: uno(fila.leads)?.full_name || fila.destinatario,
      destinatario: fila.destinatario,
      asunto: fila.asunto,
      resumen: `Respuesta · ${fila.asunto}`,
      fecha: fila.enviado_at ?? fila.created_at,
      estado: fila.estado,
      error: fila.error,
      respondidaAt: null,
      cuerpo: fila.cuerpo,
      lineas: null,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const elegido = envios.find((e) => e.clave === envio) ?? envios[0] ?? null;
  const ahora = new Date();
  const lineas = elegido?.tipo === "propuesta" ? lineasDeLaPropuesta(elegido.lineas) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <nav aria-label="Correos enviados" className="atlas-panel min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-2">
          <SegmentTabs tabs={pestanas} activeId="enviados" label="Qué conversaciones ver" />
        </div>
        {error && <p role="alert" className="px-4 pt-3 text-xs text-danger">No se pudo leer todo lo enviado: {error.message}</p>}
        {envios.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no envías correos desde Atlas. Las propuestas del cotizador y tus respuestas a clientes quedan acá.
          </p>
        ) : (
          <ul className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
            {envios.map((e) => {
              const activo = e.clave === elegido?.clave;
              return (
                <li key={e.clave}>
                  <Link
                    href={`/dashboard/conversaciones/correo?${new URLSearchParams({ vista: "enviados", envio: e.clave })}`}
                    aria-current={activo ? "true" : undefined}
                    className={cn(
                      "flex gap-3 px-3.5 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      activo ? "bg-primary/[0.07]" : "hover:bg-surface-muted/60",
                    )}
                  >
                    <Avatar name={e.cliente} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">{e.cliente}</span>
                        <time dateTime={e.fecha} title={cuando.format(new Date(e.fecha))} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {horaRelativa(e.fecha, ahora)}
                        </time>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-foreground/85">{e.resumen}</span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">Para {e.destinatario}</span>
                        {(e.estado !== "enviado" || e.respondidaAt) && (
                          <span className="shrink-0 text-[11px]">
                            <EstadoDelEnvio envio={e} />
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <section aria-label="Correo enviado" className="min-w-0">
        {elegido ? (
          <SectionCard
            title={elegido.tipo === "propuesta" ? "Propuesta comercial" : "Respuesta al cliente"}
            description={elegido.asunto}
            actions={<EstadoDelEnvio envio={elegido} />}
          >
            <dl className="grid gap-x-6 gap-y-2.5 border-t border-border/70 px-5 py-4 text-xs sm:grid-cols-2">
              {(
                [
                  ["Cliente", elegido.cliente],
                  ["Para", elegido.destinatario],
                  ["Enviado", cuando.format(new Date(elegido.fecha))],
                  elegido.tipo === "propuesta" ? ["Folio", elegido.id.slice(0, 8).toUpperCase()] : null,
                ].filter(Boolean) as [string, string][]
              ).map(([etiqueta, valor]) => (
                <div key={etiqueta} className="flex min-w-0 items-baseline justify-between gap-3 sm:justify-start">
                  <dt className="w-16 shrink-0 text-muted-foreground">{etiqueta}</dt>
                  <dd className="min-w-0 break-words font-medium text-foreground">{valor}</dd>
                </div>
              ))}
            </dl>

            {elegido.tipo === "propuesta" && lineas.length > 0 && (
              <div className="border-t border-border/70 px-5 py-4">
                <p className="text-xs font-medium text-muted-foreground">Lo que le propusiste</p>
                <ul className="mt-1 divide-y divide-border/70">
                  {lineas.map((linea, indice) => (
                    <li key={indice} className="flex items-start justify-between gap-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{linea.nombre}</span>
                        {linea.detalle && <span className="block text-xs text-muted-foreground">{linea.detalle}</span>}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{linea.monto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {elegido.cuerpo && (
              <div className="border-t border-border/70 px-5 py-4">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{elegido.cuerpo}</p>
              </div>
            )}

            {elegido.estado === "fallido" && (
              <p role="alert" className="border-t border-border/70 px-5 py-3 text-xs text-danger">
                No salió: {elegido.error ?? "el servidor de correo lo rechazó"}. Puedes volver a enviarlo desde la ficha.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-surface-raised px-5 py-3">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {elegido.respondidaAt
                  ? `El cliente respondió el ${cuando.format(new Date(elegido.respondidaAt))}.`
                  : elegido.estado === "enviado"
                    ? "«Enviado» quiere decir que el servidor de correo lo aceptó; Atlas no sabe si el cliente lo abrió."
                    : null}
              </p>
              <Link href={`/dashboard/leads/${elegido.leadId}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Abrir la ficha <ExternalLink size={12} aria-hidden="true" />
              </Link>
            </div>
          </SectionCard>
        ) : (
          <EmptyState icon={Send} title="Sin correos enviados" description="Cuando envíes una propuesta desde el cotizador o le respondas a un cliente, la verás acá con su estado." />
        )}
      </section>
    </div>
  );
}

/**
 * Supervisión entra a los buzones: el de la cuenta (sin campaña) se supervisa
 * como cola en Correo › Buzón; los de campaña, en su campaña.
 */
async function BuzonesDeSupervision() {
  const supabase = await createClient();
  const { data: mailboxes } = await supabase
    .from("inbound_mailboxes")
    .select("id, address, label, campaign_id, last_synced_at, campaigns!leads_campaign_id_fkey(name)")
    .eq("active", true)
    .order("label");

  const rows = (mailboxes ?? []) as {
    id: string;
    address: string;
    label: string | null;
    campaign_id: string | null;
    campaigns: Relacion<{ name: string }>;
  }[];
  const destino = (mailbox: (typeof rows)[number]) =>
    mailbox.campaign_id ? `/dashboard/campanas/${mailbox.campaign_id}/correo` : "/dashboard/mail?vista=buzon";

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Sin buzones activos"
        description="Ninguna de tus campañas con correo habilitado tiene un buzón configurado."
      />
    );
  }

  if (new Set(rows.map(destino)).size === 1) redirect(destino(rows[0]));

  return (
    <SectionCard title="Buzones" description="Elige el buzón que quieres revisar.">
      <ul className="divide-y divide-border/70 border-t border-border">
        {rows.map((mailbox) => (
          <li key={mailbox.id}>
            <Link
              href={destino(mailbox)}
              className="group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-muted/55"
            >
              <Avatar name={mailbox.label ?? mailbox.address} icon={Mail} shape="square" size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground group-hover:text-primary">{mailbox.label ?? mailbox.address}</span>
                <span className="block truncate text-xs text-muted-foreground">{mailbox.address}</span>
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{uno(mailbox.campaigns)?.name ?? "Buzón de la cuenta"}</span>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
