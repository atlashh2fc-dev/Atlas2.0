import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Mail, MessageCircle, Send } from "lucide-react";

import { marcarConversacionLeida, responderConversacion, responderCorreo } from "@/app/actions/conversaciones-clinica";
import { WhatsAppAutoRefresh } from "@/components/whatsapp-auto-refresh";
import { Badge, Callout, EmptyState, PageHeader, SectionCard, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA } from "@/lib/citas";
import { PACIENTES_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
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
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const voc = PACIENTES_POR_EDICION[esVet ? "vet" : "dental"];
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
    supabase.from("whatsapp_channels").select("status, display_phone_number").order("created_at").limit(1).maybeSingle(),
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
  if (hiloActual && hiloActual.sinLeer > 0) {
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
    if (actual.unread_count > 0) {
      await createAdminClient().from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", actual.id);
    }
  }

  const sinLeer = conversaciones.reduce((total, conversacion) => total + conversacion.unread_count, 0);
  const canalActivo = canal?.status === "active";
  const nombreDe = (conversacion: Conversacion) => primero(conversacion.sales_companies)?.name ?? conversacion.contact_name ?? conversacion.contact_phone;

  return (
    <div className="space-y-5">
      <WhatsAppAutoRefresh conversationId={actual?.id ?? null} />
      <PageHeader
        title="Conversaciones"
        description={`WhatsApp de ${empresa ?? "la clínica"}${canal?.display_phone_number ? ` · ${canal.display_phone_number}` : ""}. ${sinLeer ? `${sinLeer} sin leer.` : "Todo leído."} Lo que Atlas manda y lo que responden, en el mismo hilo.`}
      />

      {!canalActivo && (
        <Callout tone="warning">
          <p className="font-medium">El WhatsApp de la clínica todavía no está conectado</p>
          <p>En la demostración los envíos se simulan y quedan en el hilo. Cuando conectes el canal en Integraciones, saldrán por el número de la clínica y las respuestas llegarán acá solas.</p>
        </Callout>
      )}

      {error && <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">No se pudieron leer las conversaciones. Vuelve a cargar para reintentar.</p>}

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <SectionCard title={`Conversaciones · ${conversaciones.length + hilosCorreo.length}`} description={`WhatsApp y correo, las más recientes primero.${correoSinLeer ? ` ${correoSinLeer} correos sin leer.` : ""}`}>
          {hilosCorreo.length > 0 && (
            <ul className="divide-y divide-border border-b border-border">
              {hilosCorreo.map((hilo) => (
                <li key={`correo-${hilo.company_id}`}>
                  <Link href={`/dashboard/mensajes?e=${hilo.company_id}`} className={`block px-4 py-3 transition-colors hover:bg-surface-muted/60 ${hiloActual?.company_id === hilo.company_id ? "bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm ${hilo.sinLeer > 0 ? "font-semibold" : "font-medium"} text-foreground`}>
                        <Mail size={13} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" /> {hilo.nombre}
                      </span>
                      <span className="flex-shrink-0 text-xs text-muted-foreground">{horaCorta.format(new Date(hilo.ultimo))}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground">{hilo.asunto || hilo.direccion}</p>
                      {hilo.sinLeer > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{hilo.sinLeer}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {conversaciones.length === 0 && hilosCorreo.length === 0 ? (
            <EmptyState title="Todavía nadie escribe" description="Cuando Atlas mande un recordatorio o alguien escriba al WhatsApp de la clínica, aparece acá." />
          ) : (
            <ul className="divide-y divide-border">
              {conversaciones.map((conversacion) => {
                const ultimo = ultimoPor.get(conversacion.id);
                const activa = conversacion.id === actual?.id;
                return (
                  <li key={conversacion.id}>
                    <Link href={`/dashboard/mensajes?c=${conversacion.id}`} className={`block px-4 py-3 transition-colors hover:bg-surface-muted/60 ${activa ? "bg-primary/5" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm ${conversacion.unread_count > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                          <MessageCircle size={13} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" /> {nombreDe(conversacion)}
                        </span>
                        <span className="flex-shrink-0 text-xs text-muted-foreground">{horaCorta.format(new Date(conversacion.last_message_at))}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {ultimo ? `${ultimo.direction === "outbound" ? "Tú: " : ""}${ultimo.text_body ?? `[${ultimo.message_type}]`}` : conversacion.contact_phone}
                        </p>
                        {conversacion.unread_count > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">{conversacion.unread_count}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {hiloActual ? (
          <SectionCard title={hiloActual.nombre} description={`${hiloActual.direccion} · correo${buzon ? ` · desde ${buzon.address}` : " · la clínica todavía no tiene buzón: los envíos se simulan en la demostración"}`}>
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-4 py-3">
              {[...hiloActual.entrantes.map((correo) => ({ id: correo.id, saliente: false, cuando: correo.received_at, asunto: correo.subject, texto: correo.body_text, estado: "", messageId: correo.message_id })),
                ...hiloActual.salientes.map((correo) => ({ id: correo.id, saliente: true, cuando: correo.enviado_at ?? correo.created_at, asunto: correo.asunto ?? "", texto: correo.cuerpo ?? "", estado: correo.proveedor === "simulado" ? "simulado" : correo.estado, messageId: null }))]
                .sort((a, b) => a.cuando.localeCompare(b.cuando))
                .map((correo) => (
                  <div key={correo.id} className={`flex ${correo.saliente ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${correo.saliente ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground"}`}>
                      {correo.asunto && <p className="font-medium">{correo.asunto}</p>}
                      <p className="whitespace-pre-wrap">{correo.texto.length > 1500 ? `${correo.texto.slice(0, 1500)}…` : correo.texto}</p>
                      <p className={`mt-1 text-[11px] ${correo.saliente ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {cuando.format(new Date(correo.cuando))}
                        {correo.estado ? ` · ${correo.estado}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
            <form action={responderCorreo} className="space-y-2 border-t border-border px-4 py-3">
              <input type="hidden" name="cuenta_id" value={hiloActual.company_id} />
              <input type="hidden" name="in_reply_to" value={hiloActual.entrantes[0]?.message_id ?? ""} />
              <input
                name="asunto"
                defaultValue={hiloActual.asunto ? (hiloActual.asunto.toLowerCase().startsWith("re:") ? hiloActual.asunto : `Re: ${hiloActual.asunto}`) : ""}
                placeholder="Asunto"
                maxLength={300}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <div className="flex items-end gap-2">
                <textarea name="texto" required rows={3} maxLength={5000} placeholder={`Responder a ${hiloActual.nombre.split(" ")[0]}…`} className="min-h-[60px] flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
                <SubmitButton pendingLabel="Enviando…">
                  <Send size={16} aria-hidden="true" /> Enviar
                </SubmitButton>
              </div>
            </form>
          </SectionCard>
        ) : actual ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <SectionCard title={nombreDe(actual)} description={`${actual.contact_phone}${actual.last_inbound_at ? ` · última respuesta ${cuando.format(new Date(actual.last_inbound_at))}` : " · todavía no responde"}`}>
              <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-4 py-3">
                {hilo.length === 0 && <p className="text-sm text-muted-foreground">Sin mensajes todavía.</p>}
                {hilo.map((mensaje) => {
                  const saliente = mensaje.direction === "outbound";
                  const simulado = mensaje.provider_payload?.provider === "simulado";
                  return (
                    <div key={mensaje.id} className={`flex ${saliente ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${saliente ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground"}`}>
                        <p className="whitespace-pre-wrap">{mensaje.text_body ?? `[${mensaje.message_type}]`}</p>
                        <p className={`mt-1 text-[11px] ${saliente ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                          {cuando.format(new Date(mensaje.provider_timestamp ?? mensaje.created_at))}
                          {saliente && ESTADO_MENSAJE[mensaje.status] ? ` · ${ESTADO_MENSAJE[mensaje.status]}` : ""}
                          {simulado ? " · simulado" : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form action={responderConversacion} className="flex items-end gap-2 border-t border-border px-4 py-3">
                <input type="hidden" name="conversation_id" value={actual.id} />
                <textarea
                  name="cuerpo"
                  required
                  rows={2}
                  maxLength={4096}
                  placeholder={`Escríbele a ${nombreDe(actual).split(" ")[0]}…`}
                  className="min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
                <SubmitButton pendingLabel="Enviando…">
                  <Send size={16} aria-hidden="true" /> Enviar
                </SubmitButton>
              </form>
            </SectionCard>

            <SectionCard title={voc.singular}>
              <div className="space-y-3 px-4 py-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ficha</p>
                  <Link href={`/dashboard/pacientes/${actual.company_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {nombreDe(actual)}
                  </Link>
                  <p className="text-muted-foreground">{primero(actual.sales_companies)?.phone ?? actual.contact_phone}</p>
                  {primero(actual.sales_companies)?.email && <p className="truncate text-muted-foreground">{primero(actual.sales_companies)?.email}</p>}
                </div>
                {esVet && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Mascotas</p>
                    {ficha.mascotas.length === 0 ? (
                      <p className="text-muted-foreground">Sin mascotas registradas</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ficha.mascotas.map((mascota) => (
                          <Badge key={mascota.nombre} tone="neutral">
                            {mascota.nombre} · {mascota.especie.toLowerCase()}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Por cobrar</p>
                  <p className={`tabular-nums ${ficha.saldo > 0 ? "text-foreground" : "text-muted-foreground"}`}>{pesos.format(ficha.saldo)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Link href="/dashboard/citas" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    Agendar
                  </Link>
                  <Link href={`/dashboard/pacientes/${actual.company_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    Ver ficha
                  </Link>
                  {actual.unread_count > 0 && (
                    <form action={marcarConversacionLeida}>
                      <input type="hidden" name="conversation_id" value={actual.id} />
                      <SubmitButton variant="ghost" size="sm" pendingLabel="…">Marcar leída</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>
        ) : (
          <SectionCard title="Elige una conversación" description="A la izquierda están las más recientes. Lo que Atlas envió y lo que respondieron va en el mismo hilo.">
            <EmptyState title="Nada seleccionado" description="Toca una conversación para leerla y responder desde acá." />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
