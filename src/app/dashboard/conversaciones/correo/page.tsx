import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Inbox, Mail } from "lucide-react";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOpenCall } from "@/app/actions/calls";
import { CallTypificationForm } from "@/components/call-typification-form";
import { CorreoRegistroPanel, type CorreoEnviado, type CorreoRecibido } from "@/components/correo-registro-panel";
import { OPEN_CALL_FORM_ATTRIBUTE } from "@/lib/call-management-navigation";
import { contextoDeTipificacion } from "@/lib/tipificacion-contexto.server";
import { EsperaDelCliente, RefrescoDeBandeja, TipificarCorreo } from "@/components/puesto-correo";
import { EmptyState, SectionCard } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Pestaña de correo del puesto de atención.
 *
 * Para el ejecutivo es su bandeja: los clientes cuyo correo le asignó la cola
 * (o que son suyos por agenda, propuesta o registro), el hilo al centro y el
 * cliente al lado, como el WhatsApp. Se responde por el buzón de la cuenta y
 * se cierra con la tipificación de siempre.
 *
 * Para supervisión sigue siendo la entrada a los buzones: el de la cuenta se
 * supervisa como cola en Correo › Buzón, y los de campaña en su campaña.
 */
export default async function MailAttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ registro?: string; vista?: string }>;
}) {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  if (profile.role !== "agente") return <BuzonesDeSupervision />;
  return <BandejaDelEjecutivo profileId={profile.id} params={await searchParams} />;
}

const SLA_POR_DEFECTO = 4 * 60 * 60;
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

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

async function BandejaDelEjecutivo({ profileId, params }: { profileId: string; params: { registro?: string; vista?: string } }) {
  const supabase = await createClient();
  const vista = params.vista === "atendidos" ? "atendidos" : "pendientes";
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

  if (todas.length === 0) {
    return (
      <>
        {error && <p role="alert" className="text-sm text-danger">No se pudo leer tu correo: {error.message}</p>}
        <EmptyState
          icon={Inbox}
          title="Sin correos de clientes"
          description="Cuando un cliente responda al buzón de tu campaña, o la cola te entregue una conversación, aparece acá. Si no quieres recibir correo nuevo, apágalo en tu estado, arriba."
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

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_18rem]">
      <RefrescoDeBandeja />

      <nav aria-label="Conversaciones de correo" className="min-w-0 rounded-2xl border border-border bg-surface">
        <div className="flex gap-1 border-b border-border p-2" role="tablist">
          {[
            { clave: "pendientes", texto: `Por atender · ${porAtender.length}` },
            { clave: "atendidos", texto: `Atendidos · ${atendidos.length}` },
          ].map((opcion) => (
            <Link
              key={opcion.clave}
              role="tab"
              aria-selected={vista === opcion.clave}
              href={`/dashboard/conversaciones/correo?vista=${opcion.clave}`}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-center text-xs font-medium transition-colors",
                vista === opcion.clave ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {opcion.texto}
            </Link>
          ))}
        </div>
        {lista.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {vista === "pendientes" ? "Estás al día: ningún cliente espera respuesta." : "Todavía no cierras conversaciones este mes."}
          </p>
        ) : (
          <ul className="max-h-[calc(100dvh-16rem)] divide-y divide-border overflow-y-auto">
            {lista.map((c) => {
              const activa = c.leadId === elegida?.leadId;
              return (
                <li key={c.leadId}>
                  <Link
                    href={hrefDe(c.leadId)}
                    aria-current={activa ? "true" : undefined}
                    className={cn("block px-4 py-3 transition-colors hover:bg-surface-muted", activa && "bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]")}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{c.nombre}</span>
                      {c.pendientes > 1 && <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">{c.pendientes}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-foreground/80">{c.asunto}</span>
                    {c.vistaPrevia && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.vistaPrevia}</span>}
                    <span className="mt-1 block">
                      {c.esperaDesde ? (
                        <EsperaDelCliente desde={c.esperaDesde} slaSegundos={c.sla} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{cuando.format(new Date(c.ultimo))}</span>
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
            className="scroll-mt-4 rounded-2xl border-2 border-primary/20 bg-primary/[0.025] p-3 sm:p-5"
          >
            <p className="mb-3 text-sm font-medium text-foreground">
              Tipificación de la conversación por correo
            </p>
            <CallTypificationForm
              key={gestion.id}
              lead={tipificacion.lead}
              call={gestion}
              reasonCatalog={tipificacion.reasonCatalog}
              equifaxCommercialFieldsEnabled={tipificacion.equifaxCommercialFieldsEnabled}
              appointmentScheduleUrl={tipificacion.appointmentScheduleUrl}
              agendaPolicy={tipificacion.agendaPolicy}
              quoteClient={tipificacion.quoteClient}
            />
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
        <aside aria-label="Cliente" className="min-w-0 space-y-3 lg:col-span-2 xl:col-span-1">
          <SectionCard title={ficha?.full_name ?? elegida.nombre} icon={Mail} tone="teal">
            <dl className="space-y-2 p-4 text-sm">
              {[
                ["Campaña", uno(ficha?.campaigns ?? null)?.name],
                ["RUT", ficha?.rut],
                ["Teléfono", ficha?.phone],
                ["Correo", ficha?.email],
                ["Última tipificación", ficha?.tipificacion_actual],
                ["Próxima acción", ficha?.next_action_at ? cuando.format(new Date(ficha.next_action_at)) : null],
              ]
                .filter(([, valor]) => valor)
                .map(([etiqueta, valor]) => (
                  <div key={etiqueta as string}>
                    <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                    <dd className="break-words text-foreground">{valor}</dd>
                  </div>
                ))}
              {ficha?.observacion_actual && (
                <div>
                  <dt className="text-xs text-muted-foreground">Observación</dt>
                  <dd className="whitespace-pre-wrap break-words text-foreground">{ficha.observacion_actual}</dd>
                </div>
              )}
            </dl>
            <div className="space-y-2 border-t border-border p-4">
              {!gestion && <TipificarCorreo leadId={elegida.leadId} pendiente={elegida.pendientes > 0} />}
              <Link href={`/dashboard/leads/${elegida.leadId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                Abrir la ficha completa <ExternalLink size={12} aria-hidden="true" />
              </Link>
            </div>
          </SectionCard>
        </aside>
      )}
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
    <SectionCard title="Buzones" description="Elige el buzón que quieres revisar." icon={Inbox} tone="teal">
      <ul className="divide-y divide-border">
        {rows.map((mailbox) => (
          <li key={mailbox.id}>
            <Link
              href={destino(mailbox)}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-muted"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Mail size={16} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{mailbox.label ?? mailbox.address}</span>
                  <span className="block truncate text-xs text-muted-foreground">{mailbox.address}</span>
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{uno(mailbox.campaigns)?.name ?? "Buzón de la cuenta"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
