import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Inbox, Mail, MessageCircle, MessagesSquare, Send } from "lucide-react";

import { marcarConversacionLeida, responderConversacion, responderCorreo } from "@/app/actions/conversaciones-clinica";
import { WhatsAppAutoRefresh } from "@/components/whatsapp-auto-refresh";
import { Avatar, Callout, EmptyState, PageHeader, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA } from "@/lib/citas";
import { ATENCION_POR_EDICION, PACIENTES_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { esPrecarga } from "@/lib/ruta-pedida";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * La bandeja de WhatsApp de la clínica.
 *
 * Cada conversación es con una ficha: el tutor o el paciente, con su
 * teléfono, sus mascotas y su saldo al lado. Lo que Atlas mandó (recordatorios,
 * enlaces de pago) y lo que la persona respondió están en el mismo hilo, y se
 * contesta desde acá. Sin colas ni ejecutivos: en una clínica atiende la
 * recepción.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const horaCorta = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit" });
const diaClinica = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_CLINICA });
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });

/** "09:27" si fue hoy, "Ayer" y después la fecha corta. Antes era solo la hora, aunque fuera de la semana pasada. */
function horaRelativa(valor: string, ahora: Date) {
  const fecha = new Date(valor);
  const dia = diaClinica.format(fecha);
  if (dia === diaClinica.format(ahora)) return horaCorta.format(fecha);
  if (dia === diaClinica.format(new Date(ahora.getTime() - 86_400_000))) return "Ayer";
  return diaCorto.format(fecha);
}

type Conversacion = {
  id: string;
  company_id: string;
  contact_name: string | null;
  contact_phone: string;
  status: string;
  unread_count: number;
  last_message_at: string;
  last_inbound_at: string | null;
  sales_companies: { id: string; name: string; phone: string | null; email: string | null } | { id: string; name: string; phone: string | null; email: string | null }[] | null;
};
type Correo = { id: string; company_id: string | null; from_name: string | null; from_address: string; subject: string; body_text: string; preview: string; received_at: string; message_id: string | null; status: string; sales_companies: { id: string; name: string; phone: string | null; email: string | null } | { id: string; name: string; phone: string | null; email: string | null }[] | null };
type CorreoSaliente = { id: string; cuenta_id: string | null; destinatario: string; nombre_destinatario: string | null; asunto: string | null; cuerpo: string | null; estado: string; proveedor: string | null; enviado_at: string | null; created_at: string; in_reply_to: string | null };
type Mensaje = { id: string; conversation_id: string; direction: "inbound" | "outbound"; text_body: string | null; message_type: string; status: string; provider_timestamp: string | null; created_at: string; provider_payload: Record<string, unknown> | null };

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

const ESTADO_MENSAJE: Record<string, string> = { pending: "enviando", accepted: "enviado", sent: "enviado", delivered: "entregado", read: "leído", failed: "falló", received: "" };

export default async function MensajesPage({ searchParams }: { searchParams: Promise<{ c?: string; e?: string }> }) {
  await connection();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const voc = PACIENTES_POR_EDICION[clinicaDe(edicion)];
  const lugar = ATENCION_POR_EDICION[clinicaDe(edicion)].lugar;
  const { c, e } = await searchParams;
  const seleccionada = c && UUID.test(c) ? c : null;
  const fichaCorreo = e && UUID.test(e) ? e : null;

  const supabase = await createClient();
  const [{ data: conversacionesData, error }, { data: canal }, { data: correosData }, { data: salientesData }, { data: buzon }] = await Promise.all([
    supabase
      .from("whatsapp_conversations")
      .select("id, company_id, contact_name, contact_phone, status, unread_count, last_message_at, last_inbound_at, sales_companies(id, name, phone, email)")
      .not("company_id", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(80),
    supabase.from("whatsapp_channels").select("status, display_phone_number").eq("canal", "whatsapp").order("created_at").limit(1).maybeSingle(),
    supabase
      .from("inbound_emails")
      .select("id, company_id, from_name, from_address, subject, body_text, preview, received_at, message_id, status, sales_companies(id, name, phone, email)")
      .not("company_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(200),
    supabase
      .from("mensajes_salientes")
      .select("id, cuenta_id, destinatario, nombre_destinatario, asunto, cuerpo, estado, proveedor, enviado_at, created_at, in_reply_to")
      .eq("canal", "correo")
      .not("cuenta_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("inbound_mailboxes").select("address, label, last_synced_at, last_sync_error").is("campaign_id", null).limit(1).maybeSingle(),
  ]);
  const conversaciones = (conversacionesData ?? []) as unknown as Conversacion[];

  // Hilos de correo: uno por ficha, con lo recibido y lo que Atlas mandó.
  type HiloCorreo = { company_id: string; nombre: string; direccion: string; ultimo: string; asunto: string; entrantes: Correo[]; salientes: CorreoSaliente[]; sinLeer: number };
  const hilos = new Map<string, HiloCorreo>();
  for (const correo of (correosData ?? []) as unknown as Correo[]) {
    if (!correo.company_id) continue;
    const hilo = hilos.get(correo.company_id) ?? { company_id: correo.company_id, nombre: primero(correo.sales_companies)?.name ?? correo.from_name ?? correo.from_address, direccion: correo.from_address, ultimo: correo.received_at, asunto: correo.subject, entrantes: [], salientes: [], sinLeer: 0 };
    hilo.entrantes.push(correo);
    if (correo.status === "new") hilo.sinLeer += 1;
    if (correo.received_at > hilo.ultimo) { hilo.ultimo = correo.received_at; hilo.asunto = correo.subject; }
    hilos.set(correo.company_id, hilo);
  }
  for (const saliente of (salientesData ?? []) as unknown as CorreoSaliente[]) {
    if (!saliente.cuenta_id) continue;
    const hilo = hilos.get(saliente.cuenta_id) ?? { company_id: saliente.cuenta_id, nombre: saliente.nombre_destinatario ?? saliente.destinatario, direccion: saliente.destinatario, ultimo: saliente.enviado_at ?? saliente.created_at, asunto: saliente.asunto ?? "", entrantes: [], salientes: [], sinLeer: 0 };
    hilo.salientes.push(saliente);
    const cuando = saliente.enviado_at ?? saliente.created_at;
    if (cuando > hilo.ultimo) { hilo.ultimo = cuando; hilo.asunto = saliente.asunto ?? hilo.asunto; }
    hilos.set(saliente.cuenta_id, hilo);
  }
  const hilosCorreo = [...hilos.values()].sort((a, b) => b.ultimo.localeCompare(a.ultimo));
  const hiloActual = fichaCorreo ? hilos.get(fichaCorreo) ?? null : null;
  const correoSinLeer = hilosCorreo.reduce((total, hilo) => total + hilo.sinLeer, 0);
  // Abrir un hilo lo deja leído; una precarga del navegador no es abrirlo.
  const esVisitaReal = !esPrecarga(await headers());
  if (esVisitaReal && hiloActual && hiloActual.sinLeer > 0) {
    await createAdminClient().from("inbound_emails").update({ status: "converted", converted_at: new Date().toISOString() }).eq("company_id", hiloActual.company_id).eq("status", "new");
  }
  const ids = conversaciones.map((conversacion) => conversacion.id);

  const { data: ultimosData } = ids.length
    ? await supabase.from("whatsapp_messages").select("id, conversation_id, direction, text_body, message_type, status, provider_timestamp, created_at, provider_payload").in("conversation_id", ids).order("created_at", { ascending: false }).limit(600)
    : { data: [] };
  const ultimoPor = new Map<string, Mensaje>();
  for (const mensaje of (ultimosData ?? []) as Mensaje[]) {
    if (!ultimoPor.has(mensaje.conversation_id)) ultimoPor.set(mensaje.conversation_id, mensaje);
  }

  const actual = conversaciones.find((conversacion) => conversacion.id === seleccionada) ?? null;
  let hilo: Mensaje[] = [];
  let ficha: { mascotas: { nombre: string; especie: string }[]; saldo: number } = { mascotas: [], saldo: 0 };
  if (actual) {
    const [{ data: hiloData }, { data: mascotasData }, { data: pendientes }] = await Promise.all([
      supabase.from("whatsapp_messages").select("id, conversation_id, direction, text_body, message_type, status, provider_timestamp, created_at, provider_payload").eq("conversation_id", actual.id).order("created_at").limit(300),
      esVet ? supabase.from("mascotas").select("nombre, especie").eq("cuenta_id", actual.company_id).order("nombre") : Promise.resolve({ data: [] }),
      supabase.from("atenciones").select("precio").eq("cuenta_id", actual.company_id).eq("pagado", false),
    ]);
    hilo = (hiloData ?? []) as Mensaje[];
    ficha = {
      mascotas: ((mascotasData ?? []) as { nombre: string; especie: string }[]) ?? [],
      saldo: (pendientes ?? []).reduce((total, atencion) => total + Number(atencion.precio ?? 0), 0),
    };
    // Abrirla la deja leída. El acceso ya lo comprobó la consulta de arriba.
    if (esVisitaReal && actual.unread_count > 0) {
      await createAdminClient().from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", actual.id);
    }
  }

  const sinLeer = conversaciones.reduce((total, conversacion) => total + conversacion.unread_count, 0);
  const canalActivo = canal?.status === "active";
  const nombreDe = (conversacion: Conversacion) => primero(conversacion.sales_companies)?.name ?? conversacion.contact_name ?? conversacion.contact_phone;

  const ahora = new Date();
  // Correo y WhatsApp en una sola lista, como en Front: lo más reciente arriba.
  const filas = [
    ...hilosCorreo.map((hilo) => ({
      clave: `correo-${hilo.company_id}`,
      canal: "correo" as const,
      href: `/dashboard/mensajes?e=${hilo.company_id}`,
      nombre: hilo.nombre,
      linea: hilo.asunto || hilo.direccion,
      ultimo: hilo.ultimo,
      sinLeer: hilo.sinLeer,
      activa: hiloActual?.company_id === hilo.company_id,
    })),
    ...conversaciones.map((conversacion) => {
      const ultimo = ultimoPor.get(conversacion.id);
      return {
        clave: conversacion.id,
        canal: "whatsapp" as const,
        href: `/dashboard/mensajes?c=${conversacion.id}`,
        nombre: nombreDe(conversacion),
        linea: ultimo ? `${ultimo.direction === "outbound" ? "Tú: " : ""}${ultimo.text_body ?? `[${ultimo.message_type}]`}` : conversacion.contact_phone,
        ultimo: conversacion.last_message_at,
        sinLeer: conversacion.unread_count,
        activa: conversacion.id === actual?.id,
      };
    }),
  ].sort((a, b) => b.ultimo.localeCompare(a.ultimo));

  return (
    <div className="space-y-5">
      <WhatsAppAutoRefresh conversationId={actual?.id ?? null} />
      <PageHeader
        title="Conversaciones"
        icon={MessagesSquare}
        description={`WhatsApp de ${empresa ?? lugar}${canal?.display_phone_number ? ` · ${canal.display_phone_number}` : ""}. Lo que Atlas manda y lo que responden, en el mismo hilo.`}
        meta={
          <>
            <span>
              <span className="font-medium tabular-nums text-foreground">{sinLeer.toLocaleString("es-CL")}</span> WhatsApp sin leer
            </span>
            <span>
              <span className="font-medium tabular-nums text-foreground">{correoSinLeer.toLocaleString("es-CL")}</span> correos sin leer
            </span>
          </>
        }
      />

      {!canalActivo && (
        <Callout tone="warning">
          <p className="font-medium">El WhatsApp de {lugar} todavía no está conectado</p>
          <p>En la demostración los envíos se simulan y quedan en el hilo. Cuando conectes el canal en Integraciones, saldrán por el número de {lugar} y las respuestas llegarán acá solas.</p>
        </Callout>
      )}

      {error && <Callout tone="danger">No se pudieron leer las conversaciones. Vuelve a cargar para reintentar.</Callout>}

      <div className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-sm lg:h-[calc(100dvh-14rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <nav aria-label="Conversaciones" className="border-b border-border lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-[13px] font-semibold text-foreground">Bandeja</p>
            <span className="rounded-md bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">{filas.length}</span>
          </div>
          {filas.length === 0 ? (
            <EmptyState icon={Inbox} title="Todavía nadie escribe" description={`Cuando Atlas mande un recordatorio o alguien escriba al WhatsApp de ${lugar}, aparece acá.`} />
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
              {filas.map((fila) => (
                <li key={fila.clave}>
                  <Link
                    href={fila.href}
                    aria-current={fila.activa ? "true" : undefined}
                    className={`flex gap-3 px-3.5 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${fila.activa ? "bg-primary/[0.07]" : "hover:bg-surface-muted/60"}`}
                  >
                    <span className="relative shrink-0">
                      <Avatar name={fila.nombre} size="md" />
                      {/* El canal, sobre el avatar: correo o WhatsApp. */}
                      <span className="absolute -bottom-1 -right-1 rounded-md bg-surface ring-2 ring-surface" title={fila.canal === "correo" ? "Correo" : "WhatsApp"}>
                        <span className="icon-chip size-[18px] rounded-md" data-tone={fila.canal === "correo" ? "teal" : "green"}>
                          {fila.canal === "correo" ? <Mail size={10} aria-hidden="true" /> : <MessageCircle size={10} aria-hidden="true" />}
                        </span>
                        <span className="sr-only">{fila.canal === "correo" ? "Correo" : "WhatsApp"}</span>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[13px] text-foreground ${fila.sinLeer > 0 ? "font-semibold" : "font-medium"}`}>{fila.nombre}</span>
                        <time dateTime={fila.ultimo} title={cuando.format(new Date(fila.ultimo))} className={`shrink-0 text-[11px] tabular-nums ${fila.sinLeer > 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                          {horaRelativa(fila.ultimo, ahora)}
                        </time>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={`truncate text-xs ${fila.sinLeer > 0 ? "text-foreground" : "text-muted-foreground"}`}>{fila.linea}</span>
                        {fila.sinLeer > 0 && (
                          <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary">{fila.sinLeer}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {hiloActual ? (
          <section aria-label={`Correo con ${hiloActual.nombre}`} className="flex min-h-0 flex-col">
            <Cabecera nombre={hiloActual.nombre} detalle={`${hiloActual.direccion} · correo${buzon ? ` · desde ${buzon.address}` : ` · ${lugar} todavía no tiene buzón: los envíos se simulan en la demostración`}`} />
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:max-h-none max-h-[60vh]">
              {[...hiloActual.entrantes.map((correo) => ({ id: correo.id, saliente: false, cuando: correo.received_at, asunto: correo.subject, texto: correo.body_text, estado: "", messageId: correo.message_id })),
                ...hiloActual.salientes.map((correo) => ({ id: correo.id, saliente: true, cuando: correo.enviado_at ?? correo.created_at, asunto: correo.asunto ?? "", texto: correo.cuerpo ?? "", estado: correo.proveedor === "simulado" ? "simulado" : correo.estado, messageId: null }))]
                .sort((a, b) => a.cuando.localeCompare(b.cuando))
                .map((correo) => (
                  <div key={correo.id} className={`flex ${correo.saliente ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground ${correo.saliente ? "rounded-br-md bg-primary/[0.13]" : "rounded-bl-md border border-border bg-surface shadow-sm"}`}>
                      {correo.asunto && <p className="font-semibold">{correo.asunto}</p>}
                      <p className="whitespace-pre-wrap">{correo.texto.length > 1500 ? `${correo.texto.slice(0, 1500)}…` : correo.texto}</p>
                      <p className="mt-1 text-right text-[11px] text-muted-foreground">
                        {cuando.format(new Date(correo.cuando))}
                        {correo.estado ? ` · ${correo.estado}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
            <form action={responderCorreo} className="space-y-2 border-t border-border bg-surface px-4 py-3">
              <input type="hidden" name="cuenta_id" value={hiloActual.company_id} />
              <input type="hidden" name="in_reply_to" value={hiloActual.entrantes[0]?.message_id ?? ""} />
              <div className="rounded-xl border border-border-strong/70 bg-surface shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                <input
                  name="asunto"
                  defaultValue={hiloActual.asunto ? (hiloActual.asunto.toLowerCase().startsWith("re:") ? hiloActual.asunto : `Re: ${hiloActual.asunto}`) : ""}
                  placeholder="Asunto"
                  maxLength={300}
                  aria-label="Asunto"
                  className="block w-full border-0 border-b border-border/70 bg-transparent px-3.5 py-2.5 text-[13px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <textarea name="texto" required rows={3} maxLength={5000} aria-label="Respuesta" placeholder={`Responder a ${hiloActual.nombre.split(" ")[0]}…`} className="block min-h-[72px] w-full resize-y border-0 bg-transparent px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
                <div className="flex justify-end px-1.5 pb-1.5">
                  <SubmitButton size="sm" pendingLabel="Enviando…">
                    <Send size={14} aria-hidden="true" /> Enviar
                  </SubmitButton>
                </div>
              </div>
            </form>
          </section>
        ) : actual ? (
          <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <section aria-label={`WhatsApp con ${nombreDe(actual)}`} className="flex min-h-0 flex-col">
              <Cabecera nombre={nombreDe(actual)} detalle={`${actual.contact_phone}${actual.last_inbound_at ? ` · última respuesta ${cuando.format(new Date(actual.last_inbound_at))}` : " · todavía no responde"}`} />
              <div className="max-h-[60vh] min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:max-h-none">
                {hilo.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Sin mensajes todavía.</p>}
                {hilo.map((mensaje) => {
                  const saliente = mensaje.direction === "outbound";
                  const simulado = mensaje.provider_payload?.provider === "simulado";
                  return (
                    <div key={mensaje.id} className={`flex ${saliente ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed text-foreground ${saliente ? "rounded-br-md bg-primary/[0.13]" : "rounded-bl-md border border-border bg-surface shadow-sm"}`}>
                        <p className="whitespace-pre-wrap">{mensaje.text_body ?? `[${mensaje.message_type}]`}</p>
                        <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
                          {cuando.format(new Date(mensaje.provider_timestamp ?? mensaje.created_at))}
                          {saliente && ESTADO_MENSAJE[mensaje.status] ? ` · ${ESTADO_MENSAJE[mensaje.status]}` : ""}
                          {simulado ? " · simulado" : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Compositor pegado abajo, en un solo bloque con el botón. */}
              <form action={responderConversacion} className="border-t border-border bg-surface px-4 py-3">
                <input type="hidden" name="conversation_id" value={actual.id} />
                <div className="rounded-xl border border-border-strong/70 bg-surface shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                  <textarea
                    name="cuerpo"
                    required
                    rows={2}
                    maxLength={4096}
                    aria-label="Mensaje"
                    placeholder={`Escríbele a ${nombreDe(actual).split(" ")[0]}…`}
                    className="block min-h-[52px] w-full resize-y border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <div className="flex justify-end px-1.5 pb-1.5">
                    <SubmitButton size="sm" pendingLabel="Enviando…">
                      <Send size={14} aria-hidden="true" /> Enviar
                    </SubmitButton>
                  </div>
                </div>
              </form>
            </section>

            <aside aria-label={voc.singular} className="border-t border-border xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
              <div className="flex items-center gap-3 border-b border-border/70 px-4 py-4">
                <Avatar name={nombreDe(actual)} size="lg" />
                <div className="min-w-0">
                  <Link href={`/dashboard/pacientes/${actual.company_id}`} className="block truncate text-[15px] font-semibold text-foreground hover:text-primary">
                    {nombreDe(actual)}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{voc.singular}</p>
                </div>
              </div>
              <dl className="space-y-2.5 px-4 py-4 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Teléfono</dt>
                  <dd className="text-right font-medium tabular-nums text-foreground">{primero(actual.sales_companies)?.phone ?? actual.contact_phone}</dd>
                </div>
                {primero(actual.sales_companies)?.email && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Correo</dt>
                    <dd className="min-w-0 truncate text-right font-medium text-foreground">{primero(actual.sales_companies)?.email}</dd>
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Por cobrar</dt>
                  <dd className={`text-right font-medium tabular-nums ${ficha.saldo > 0 ? "text-foreground" : "text-muted-foreground"}`}>{pesos.format(ficha.saldo)}</dd>
                </div>
                {esVet && (
                  <div className="pt-1">
                    <dt className="text-muted-foreground">Mascotas</dt>
                    {ficha.mascotas.length === 0 ? (
                      <dd className="mt-1 text-muted-foreground">Sin mascotas registradas</dd>
                    ) : (
                      <dd className="mt-1.5 space-y-1.5">
                        {ficha.mascotas.map((mascota) => (
                          <span key={mascota.nombre} className="flex items-center gap-2 text-foreground">
                            <Avatar name={mascota.nombre} size="xs" />
                            <span className="truncate">{mascota.nombre}</span>
                            <span className="text-muted-foreground">· {mascota.especie.toLowerCase()}</span>
                          </span>
                        ))}
                      </dd>
                    )}
                  </div>
                )}
              </dl>
              <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-4 py-4">
                <Link href="/dashboard/citas" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  Agendar
                </Link>
                <Link href={`/dashboard/pacientes/${actual.company_id}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                  Ver ficha
                </Link>
                {actual.unread_count > 0 && (
                  <form action={marcarConversacionLeida}>
                    <input type="hidden" name="conversation_id" value={actual.id} />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="…">Marcar leída</SubmitButton>
                  </form>
                )}
              </div>
            </aside>
          </div>
        ) : (
          <EmptyState icon={MessagesSquare} title="Elige una conversación" description="A la izquierda están las más recientes. Lo que Atlas envió y lo que respondieron va en el mismo hilo." />
        )}
      </div>
    </div>
  );
}

/** Quién es y por dónde: nombre con avatar y una línea de contexto. */
function Cabecera({ nombre, detalle }: { nombre: string; detalle: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Avatar name={nombre} size="md" />
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold text-foreground">{nombre}</h2>
        <p className="truncate text-xs text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );
}
