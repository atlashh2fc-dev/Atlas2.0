import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flag,
  History,
  ListTodo,
  Mail,
  MessageCircle,
  PhoneCall,
  Send,
  Signpost,
  StickyNote,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

import { moverEtapa, registrarGestion } from "@/app/actions/ventas";
import { cerrarNegocio, escribirAlNegocio, fijarProximaAccion } from "@/app/actions/pipeline";
import { ETIQUETA_ESTADO_MENSAJE, type EstadoMensaje } from "@/lib/mensajes/plantillas";
import { MailThreadPanel, type LeadMailMessage, type LeadMailReplyCommand } from "@/components/mail-thread-panel";
import {
  ActionForm,
  ActionSubmit,
  Avatar,
  Badge,
  buttonClasses,
  Callout,
  EmptyState,
  Field,
  Input,
  SectionCard,
  Select,
} from "@/components/ui";
import {
  CountBox,
  Property,
  PropertyGroup,
  PropertyList,
  RecordFact,
  RecordFacts,
  RecordHeader,
  StateChip,
  Timeline,
  TimelineItem,
  TimelineNote,
  dateTimeLabel,
  dayLabel,
  relativeLabel,
  sentenceCase,
  type ChipTone,
} from "@/components/record-kit";
import { requireProfile } from "@/lib/auth";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Sin precio acordado todavía, decirlo vale más que un "$0" que parece un dato. */
function formatoMonto(numero: number, mensual: boolean): string {
  return numero > 0 ? `${pesos.format(numero)}${mensual ? " al mes" : ""}` : "Monto por definir";
}

/** Lo que una clínica guarda de la persona además de sus datos: mascota, profesional. */
function detallePersona(metadata: unknown): { etiqueta: string; valor: string }[] {
  if (!metadata || typeof metadata !== "object") return [];
  const datos = metadata as Record<string, unknown>;
  const filas: { etiqueta: string; valor: string }[] = [];
  const mascota = [datos.mascota, datos.especie, datos.raza].filter((valor) => typeof valor === "string" && valor);
  if (mascota.length > 0) filas.push({ etiqueta: "Mascota", valor: mascota.join(" · ") });
  if (typeof datos.profesional === "string" && datos.profesional) {
    filas.push({ etiqueta: "Profesional", valor: datos.profesional });
  }
  if (typeof datos.prevision === "string" && datos.prevision) {
    filas.push({ etiqueta: "Previsión", valor: datos.prevision });
  }
  return filas;
}
const ETIQUETA_GESTION: Record<string, string> = {
  llamada: "Llamada",
  correo: "Correo",
  whatsapp: "WhatsApp",
  reunion: "Reunión",
  nota: "Nota",
  tarea: "Tarea",
  etapa: "Embudo",
};

/** Ícono y tono de cada tipo de gestión en la línea de tiempo. */
const TIPO_GESTION: Record<string, { icon: typeof PhoneCall; tone: ChipTone }> = {
  llamada: { icon: PhoneCall, tone: "primary" },
  correo: { icon: Mail, tone: "teal" },
  whatsapp: { icon: MessageCircle, tone: "green" },
  reunion: { icon: Users, tone: "violet" },
  nota: { icon: StickyNote, tone: "slate" },
  tarea: { icon: ListTodo, tone: "amber" },
  etapa: { icon: ArrowRightLeft, tone: "blue" },
};

/** Supabase entrega las relaciones como arreglo; acá siempre es una sola fila. */
function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

/** Ficha del negocio: quién es, en qué va, qué se hizo y qué sigue. */
export default async function OportunidadPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: negocio } = await supabase
    .from("sales_opportunities")
    .select(
      "id, name, status, monthly_amount, one_time_amount, expected_close_date, next_action_at, next_action_note, source, lost_reason, stage_id, lead_id, sales_companies(id, name, rut, industry, commune, website, phone, email, metadata), sales_contacts(id, full_name, role_title, email, phone), sales_stages(key, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!negocio) notFound();

  const [{ data: etapas }, { data: gestiones }] = await Promise.all([
    supabase
      .from("sales_stages")
      .select("key, name, position, is_won, is_lost")
      .eq("active", true)
      .order("position"),
    supabase
      .from("sales_activities")
      .select("id, kind, subject, body, occurred_at, due_at, done")
      .eq("opportunity_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const empresa = primero(negocio.sales_companies);
  const contacto = primero(negocio.sales_contacts);
  const { data: mensajesData } = await supabase
    .from("mensajes_salientes")
    .select("id, canal, asunto, cuerpo, estado, error, created_at")
    .eq("origen_ref", negocio.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const mensajesEnviados = (mensajesData ?? []) as { id: string; canal: string; asunto: string | null; cuerpo: string | null; estado: string; error: string | null; created_at: string }[];

  // El registro del que viene el negocio: por enlace directo o por el correo del contacto.
  let leadId = (negocio as { lead_id?: string | null }).lead_id ?? null;
  const correoContacto = (contacto?.email ?? empresa?.email ?? "").trim().toLowerCase();
  if (!leadId && correoContacto) {
    const { data: registro } = await supabase.from("leads").select("id").ilike("email", correoContacto).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    leadId = (registro?.id as string | undefined) ?? null;
  }
  const [{ data: hiloData }, { data: comandosData }, { data: senalesData }] = leadId
    ? await Promise.all([
        supabase.from("lead_mail_messages").select("id, direction, from_email, to_email, subject, body_text, occurred_at, external_message_id").eq("lead_id", leadId).order("occurred_at", { ascending: true }).limit(50),
        supabase.from("mail_reply_commands").select("id, subject, body_text, status, last_error, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(20),
        supabase.from("external_lead_events").select("id, event_type, occurred_at, created_at, integration_sources(name)").eq("lead_id", leadId).order("occurred_at", { ascending: false, nullsFirst: false }).limit(20),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const hiloCampana = (hiloData ?? []) as LeadMailMessage[];
  const comandosCampana = (comandosData ?? []) as LeadMailReplyCommand[];
  const senales = (senalesData ?? []) as { id: string; event_type: string; occurred_at: string | null; created_at: string; integration_sources: { name: string } | { name: string }[] | null }[];
  const etapaActual = primero(negocio.sales_stages);
  const abierto = negocio.status === "abierta";
  const voc = VENTAS_POR_EDICION[(await contextoDeMiEmpresa()).edicion];
  const mensual = voc.monto === "mensual";
  const monto = Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const detalle = detallePersona(empresa?.metadata);
  // Escribir desde la ficha abre el correo o el WhatsApp de quien atiende; lo
  // que se conversó se registra abajo, en "Registrar gestión".
  const correo = contacto?.email ?? empresa?.email ?? null;
  const telefono = (contacto?.phone ?? empresa?.phone ?? "").replace(/\D/g, "");
  const whatsapp = telefono.length >= 11 ? telefono : null;

  // Estado del negocio con ícono en chip: ganado, perdido o en curso.
  const estado =
    negocio.status === "ganada"
      ? { icon: CheckCircle2, tone: "green" as const, danger: false }
      : negocio.status === "perdida"
        ? { icon: XCircle, tone: "rose" as const, danger: true }
        : { icon: Signpost, tone: "primary" as const, danger: false };
  const proximaVencida = negocio.next_action_at ? new Date(negocio.next_action_at).getTime() <= new Date().getTime() : false;
  const listaGestiones = gestiones ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/ventas"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        Volver a {voc.negocios.toLowerCase()}
      </Link>

      <RecordHeader
        name={empresa?.name ?? voc.negocio}
        seed={empresa?.rut ?? empresa?.name ?? negocio.name}
        eyebrow={negocio.name}
        identifiers={[
          empresa?.rut ? <span className="tabular-nums">RUT {empresa.rut}</span> : null,
          empresa?.industry ?? null,
          empresa?.commune ?? null,
        ]}
        actions={
          <>
            {leadId && (
              <Link className={buttonClasses({ variant: "ghost", size: "sm" })} href={`/dashboard/leads/${leadId}`}>
                Ver registro
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            )}
            {(correo || whatsapp) && (
              <a className={buttonClasses({ variant: "secondary", size: "sm" })} href="#escribir">
                <Send size={13} aria-hidden="true" />
                Escribir desde Atlas
              </a>
            )}
          </>
        }
        facts={
          <RecordFacts>
            <RecordFact label="Etapa" detail={negocio.source ? `Origen: ${negocio.source}` : undefined}>
              <StateChip icon={estado.icon} tone={estado.tone} label={etapaActual?.name ?? "Sin etapa"} danger={estado.danger} />
            </RecordFact>
            <RecordFact label={mensual ? "Monto mensual" : "Monto"}>
              <span className={monto > 0 ? "tabular-nums" : "text-muted-foreground"}>{formatoMonto(monto, mensual)}</span>
            </RecordFact>
            <RecordFact
              label="Próxima acción"
              detail={negocio.next_action_at ? negocio.next_action_note ?? dateTimeLabel(negocio.next_action_at) : "Nada agendado"}
            >
              {negocio.next_action_at ? (
                <span className={proximaVencida && abierto ? "text-danger" : undefined} title={dateTimeLabel(negocio.next_action_at)}>
                  {proximaVencida && abierto ? "Vencida · " : ""}
                  {relativeLabel(negocio.next_action_at)}
                </span>
              ) : (
                <span className="text-muted-foreground">Sin agendar</span>
              )}
            </RecordFact>
            <RecordFact label="Cierre estimado">
              {negocio.expected_close_date ? (
                // Es una fecha sin hora: al mediodía no se corre de día por la zona.
                dayLabel(`${String(negocio.expected_close_date).slice(0, 10)}T12:00:00Z`)
              ) : (
                <span className="text-muted-foreground">Sin fecha</span>
              )}
            </RecordFact>
            <RecordFact label="Actividad" detail={listaGestiones[0] ? `Última ${relativeLabel(listaGestiones[0].occurred_at).toLocaleLowerCase("es-CL")}` : undefined}>
              <span className="tabular-nums">
                {listaGestiones.length} {listaGestiones.length === 1 ? "gestión" : "gestiones"}
              </span>
            </RecordFact>
          </RecordFacts>
        }
      />

      {negocio.lost_reason && <Callout tone="danger">Motivo de pérdida: {negocio.lost_reason}</Callout>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div className="min-w-0 space-y-5">
          <SectionCard title="Registrar gestión" description="Con fecha futura queda como la próxima acción.">
            <ActionForm action={registrarGestion} success="Gestión registrada">
              <input type="hidden" name="oportunidad_id" value={negocio.id} />
              <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4">
                <Field label="Tipo">
                  <Select name="tipo" defaultValue="llamada">
                    <option value="llamada">Llamada</option>
                    <option value="correo">Correo</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="reunion">Reunión</option>
                    <option value="nota">Nota</option>
                    <option value="tarea">Tarea</option>
                  </Select>
                </Field>
                <Field label="Qué pasó o qué hay que hacer" className="min-w-[14rem] flex-1">
                  <Input name="asunto" required placeholder="Le envié la propuesta" />
                </Field>
                <Field label="Cuándo (opcional)">
                  <Input name="vence" type="datetime-local" />
                </Field>
                {/* La acción principal de la ficha: el resto de los botones son secundarios. */}
                <ActionSubmit pendingLabel="Registrando…">Registrar</ActionSubmit>
              </div>
            </ActionForm>
          </SectionCard>

          <SectionCard
            title="Historia"
            description={`Todo lo que pasó con ${mensual ? "este negocio" : `este ${voc.negocio.toLowerCase()}`}.`}
            actions={<CountBox>{listaGestiones.length}</CountBox>}
          >
            {listaGestiones.length === 0 ? (
              <EmptyState
                icon={History}
                title="Sin gestiones todavía"
                description="Registra la primera arriba: queda acá con su fecha y, si es futura, como próxima acción."
                className="border-t border-border py-10"
              />
            ) : (
              <Timeline className="border-t border-border px-5 py-5">
                {listaGestiones.map((gestion, index) => {
                  const tipo = TIPO_GESTION[gestion.kind] ?? { icon: StickyNote, tone: "slate" as const };
                  return (
                    <TimelineItem
                      key={gestion.id}
                      icon={tipo.icon}
                      tone={tipo.tone}
                      title={gestion.subject ?? "—"}
                      date={gestion.due_at ?? gestion.occurred_at}
                      meta={
                        <>
                          <span>{ETIQUETA_GESTION[gestion.kind] ?? gestion.kind}</span>
                          {!gestion.done && (
                            <>
                              <span aria-hidden="true">·</span>
                              <Badge tone="warning">Pendiente</Badge>
                            </>
                          )}
                        </>
                      }
                      last={index === listaGestiones.length - 1}
                    >
                      {gestion.body && <TimelineNote>{gestion.body}</TimelineNote>}
                    </TimelineItem>
                  );
                })}
              </Timeline>
            )}
          </SectionCard>

          <div id="escribir" className="scroll-mt-4" />
          <SectionCard
            title="Escribir desde Atlas"
            description="Correo al contacto del negocio por el puente con Atlas Lead; WhatsApp si la empresa tiene el canal. Queda en la historia y con su estado."
          >
            <ActionForm action={escribirAlNegocio} success="Mensaje enviado; queda en la historia del negocio" className="space-y-3 border-t border-border px-5 py-4">
              <input type="hidden" name="oportunidad_id" value={negocio.id} />
              <input type="hidden" name="cuenta_id" value={empresa?.id ?? ""} />
              <div className="flex flex-wrap gap-2">
                <Select name="canal" defaultValue="correo" aria-label="Canal" className="w-40">
                  <option value="correo">Correo{(empresa?.email ?? contacto?.email) ? ` · ${empresa?.email ?? contacto?.email}` : " · sin correo"}</option>
                  <option value="whatsapp">WhatsApp{(empresa?.phone ?? contacto?.phone) ? ` · ${empresa?.phone ?? contacto?.phone}` : " · sin celular"}</option>
                </Select>
                <Input name="asunto" placeholder="Asunto (correo)" className="flex-1" defaultValue={`Sobre ${negocio.name}`} />
              </div>
              <textarea name="texto" required rows={4} maxLength={5000} placeholder={`Hola ${contacto?.full_name?.split(" ")[0] ?? ""}, …`} className="w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" />
              <div className="flex justify-end">
                <ActionSubmit variant="secondary" pendingLabel="Enviando…">Enviar</ActionSubmit>
              </div>
            </ActionForm>
            {mensajesEnviados.length > 0 && (
              <ul className="divide-y divide-border border-t border-border">
                {mensajesEnviados.map((mensaje) => {
                  const etiqueta = ETIQUETA_ESTADO_MENSAJE[mensaje.estado as EstadoMensaje] ?? ETIQUETA_ESTADO_MENSAJE.programado;
                  const esCorreo = mensaje.canal === "correo";
                  return (
                    <li key={mensaje.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <span className="icon-chip mt-0.5 size-7 rounded-lg" data-tone={esCorreo ? "teal" : "green"} aria-hidden="true">
                        {esCorreo ? <Mail size={13} /> : <MessageCircle size={13} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{mensaje.asunto ?? mensaje.cuerpo ?? ""}</p>
                        <p className="text-xs text-muted-foreground" title={dateTimeLabel(mensaje.created_at)}>
                          {esCorreo ? "Correo" : "WhatsApp"} · {relativeLabel(mensaje.created_at)}
                        </p>
                        {mensaje.error && <p className="mt-0.5 text-xs text-danger">{mensaje.error}</p>}
                      </div>
                      <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {leadId && senales.length > 0 && (
            <SectionCard
              title="Señales de la campaña de correo"
              description="Lo que llegó desde Atlas Lead: aperturas, clics y respuestas de esta persona."
              actions={<CountBox>{senales.length}</CountBox>}
            >
              <ul className="divide-y divide-border border-t border-border">
                {senales.slice(0, 12).map((senal) => {
                  const fecha = senal.occurred_at ?? senal.created_at;
                  const fuente = primero(senal.integration_sources)?.name ?? null;
                  return (
                    <li key={senal.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="icon-chip size-6 rounded-md" data-tone="teal" aria-hidden="true">
                        <Mail size={12} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {sentenceCase(senal.event_type.replace(/[._]/g, " "))}
                        {fuente && <span className="text-muted-foreground"> · {fuente}</span>}
                      </span>
                      <time className="shrink-0 text-xs tabular-nums text-muted-foreground" title={dateTimeLabel(fecha)}>
                        {relativeLabel(fecha)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}

          {leadId && hiloCampana.length > 0 && (
            <MailThreadPanel leadId={leadId} messages={hiloCampana} commands={comandosCampana} canReply={false} />
          )}
        </div>

        <aside
          aria-label={`Datos del ${voc.negocio.toLowerCase()}`}
          className="atlas-panel divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
        >
          <PropertyGroup icon={Building2} title={voc.cuenta}>
            <PropertyList>
              <Property label="Nombre">{empresa?.name ?? "—"}</Property>
              {empresa?.rut && <Property label="RUT"><span className="tabular-nums">{empresa.rut}</span></Property>}
              {voc.personas && (contacto?.phone ?? empresa?.phone) && (
                <Property label="Teléfono"><span className="tabular-nums">{contacto?.phone ?? empresa?.phone}</span></Property>
              )}
              {voc.personas && (contacto?.email ?? empresa?.email) && (
                <Property label="Correo"><span className="break-all">{contacto?.email ?? empresa?.email}</span></Property>
              )}
              {empresa?.industry && <Property label="Rubro">{empresa.industry}</Property>}
              {empresa?.commune && <Property label="Comuna">{empresa.commune}</Property>}
              {empresa?.website && (
                <Property label="Sitio">
                  <a className="break-all text-foreground hover:text-primary hover:underline" href={empresa.website} target="_blank" rel="noopener noreferrer">
                    {empresa.website.replace(/^https?:\/\//, "")}
                  </a>
                </Property>
              )}
            </PropertyList>
          </PropertyGroup>

          {voc.personas ? (
            <PropertyGroup icon={FileText} title="Ficha">
              {detalle.length > 0 ? (
                <PropertyList>
                  {detalle.map((fila) => (
                    <Property key={fila.etiqueta} label={fila.etiqueta}>{fila.valor}</Property>
                  ))}
                </PropertyList>
              ) : (
                <p className="text-[13px] text-muted-foreground">Sin datos adicionales.</p>
              )}
            </PropertyGroup>
          ) : (
            <PropertyGroup icon={UserRound} title="Contacto">
              {contacto ? (
                <div className="flex items-start gap-2.5 text-[13px]">
                  <Avatar name={contacto.full_name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{contacto.full_name}</p>
                    {contacto.role_title && <p className="text-xs text-muted-foreground">{contacto.role_title}</p>}
                    {contacto.email && <p className="mt-1 break-all text-foreground">{contacto.email}</p>}
                    {contacto.phone && <p className="tabular-nums text-foreground">{contacto.phone}</p>}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">Sin contacto registrado.</p>
              )}
            </PropertyGroup>
          )}

          {abierto && (
            <PropertyGroup icon={ArrowRightLeft} title={mensual ? "Mover el negocio" : `Mover el ${voc.negocio.toLowerCase()}`}>
              <ActionForm action={moverEtapa} success="Etapa actualizada" className="space-y-2.5">
                <input type="hidden" name="oportunidad_id" value={negocio.id} />
                <Field label="Etapa">
                  <Select name="etapa" defaultValue={etapaActual?.key ?? ""}>
                    {(etapas ?? []).map((etapa) => (
                      <option key={etapa.key} value={etapa.key}>
                        {etapa.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nota (motivo si se pierde)">
                  <Input name="nota" placeholder="Pidió esperar al próximo trimestre" />
                </Field>
                <p className="text-xs text-muted-foreground">Cada movimiento queda registrado en la historia.</p>
                <ActionSubmit size="sm" variant="secondary" pendingLabel="Actualizando…">Actualizar</ActionSubmit>
              </ActionForm>
            </PropertyGroup>
          )}

          <PropertyGroup icon={CalendarClock} title="Próxima acción">
            <ActionForm action={fijarProximaAccion} success="Próxima acción fijada" className="space-y-2">
              <input type="hidden" name="oportunidad_id" value={negocio.id} />
              <div className="flex gap-2">
                <Input type="date" name="fecha" required className="flex-1" aria-label="Fecha" />
                <Input type="time" name="hora" defaultValue="09:00" className="w-28" aria-label="Hora" />
              </div>
              <Input name="nota" placeholder="Qué toca hacer" defaultValue={negocio.next_action_note ?? ""} aria-label="Qué toca hacer" />
              <ActionSubmit size="sm" variant="secondary" pendingLabel="Fijando…">Fijar</ActionSubmit>
            </ActionForm>
          </PropertyGroup>

          {negocio.status === "abierta" && (
            // Dos formularios: ActionForm arma el FormData sin el botón que lo
            // envió, así que «resultado» va oculto en cada uno. Perdido pide
            // confirmar y queda separado de Ganado, al final de la columna.
            <PropertyGroup icon={Flag} title="Cerrar">
              <div className="space-y-3">
                <ActionForm action={cerrarNegocio} success="Negocio cerrado como ganado">
                  <input type="hidden" name="oportunidad_id" value={negocio.id} />
                  <input type="hidden" name="resultado" value="ganado" />
                  <ActionSubmit size="sm" variant="secondary" pendingLabel="Cerrando…">
                    <CheckCircle2 size={13} aria-hidden="true" />
                    Ganado
                  </ActionSubmit>
                </ActionForm>
                <ActionForm
                  action={cerrarNegocio}
                  success="Negocio cerrado como perdido"
                  className="space-y-2 border-t border-border pt-3"
                  confirm={{
                    title: "¿Cerrar el negocio como perdido?",
                    description: `${negocio.name} sale del tablero y pasa a Cerrados con el motivo que escribiste. No se reabre desde esta ficha.`,
                    confirmLabel: "Cerrar como perdido",
                    tone: "danger",
                  }}
                >
                  <input type="hidden" name="oportunidad_id" value={negocio.id} />
                  <input type="hidden" name="resultado" value="perdido" />
                  <Input name="motivo" placeholder="Motivo de la pérdida" aria-label="Motivo de la pérdida" />
                  <ActionSubmit size="sm" variant="danger" pendingLabel="Cerrando…">Perdido</ActionSubmit>
                </ActionForm>
              </div>
            </PropertyGroup>
          )}
        </aside>
      </div>
    </div>
  );
}
