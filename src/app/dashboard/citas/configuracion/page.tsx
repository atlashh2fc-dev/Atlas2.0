import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ExternalLink, MessageSquareText, Settings2 } from "lucide-react";

import { guardarHorarioEmpresa, guardarOfertaEnLinea, guardarRecordatorios, guardarReservaEnLinea } from "@/app/actions/configuracion-agenda";
import { agregarPlantillasSugeridas, crearPlantillaConsentimiento, guardarPlantillaConsentimiento } from "@/app/actions/consentimientos";
import { CreatePanel } from "@/components/create-panel";
import { PLANTILLAS_SUGERIDAS } from "@/lib/consentimientos";
import { CopiarTexto, HorarioSemanal } from "@/components/agenda-config-cliente";
import { TextoPlantillaEditor } from "@/components/texto-plantilla-editor";
import { ActionForm, ActionSubmit, Badge, Callout, Field, Input, PageHeader, SectionCard, Select, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import {
  configuracionDesdeFila,
  HORARIO_POR_DEFECTO,
  HORAS_DE_ENVIO,
  OPCIONES_ANTICIPACION,
  OPCIONES_RESERVA,
  resumenRecordatorio,
  tramosPorDia,
  type TramoHorario,
} from "@/lib/configuracion-agenda";
import { codigoParaWeb, enlaceDeReserva, normalizarSlug, serviciosPorCategoria } from "@/lib/reserva";
import { clinicaDe } from "@/lib/ediciones";
import { PLANTILLAS, PLANTILLAS_EDITABLES, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Configurar la agenda: cuándo sale el recordatorio de cita, si la respuesta
 * de la persona confirma o cancela sola, y el texto de cada mensaje.
 *
 * Supervisión ve la configuración; solo un administrador la cambia.
 */

const MENSAJES_DE_CITA: ClavePlantilla[] = ["cita_confirmar", "cita_recordatorio", "cita_confirmada", "cita_cancelada", "cita_reagendar", "reserva_recibida"];

export default async function ConfiguracionAgendaPage() {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const puedeEditar = profile.role === "admin";
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const tipo = clinicaDe(edicion);
  const supabase = await createClient();
  const { data: orgId } = await supabase.rpc("current_org_id");
  const { data } = typeof orgId === "string"
    ? await supabase.from("configuracion_agenda").select("*").eq("organization_id", orgId).maybeSingle()
    : { data: null };
  const configuracion = configuracionDesdeFila(data);
  const [{ data: horarioData }, { data: profesionalesData }, { data: serviciosData }, { data: organizacion }, { data: plantillasData }] = await Promise.all([
    supabase.from("horarios_atencion").select("dia_semana, desde, hasta").is("profesional_id", null).order("dia_semana").order("desde"),
    supabase.from("profesionales").select("id, nombre, en_reserva_online").eq("activo", true).order("orden").order("nombre"),
    supabase.from("sales_products").select("id, name, categoria, duracion_min, one_time_price, en_reserva_online").eq("active", true).eq("es_urgencia", false).order("orden").order("name").limit(400),
    typeof orgId === "string" ? supabase.from("organizations").select("slug").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("plantillas_consentimiento").select("id, titulo, texto, activo").order("titulo"),
  ]);
  const plantillasConsentimiento = (plantillasData ?? []) as { id: string; titulo: string; texto: string; activo: boolean }[];
  const horario = tramosPorDia(((horarioData ?? []) as TramoHorario[]).length ? (horarioData as TramoHorario[]) : HORARIO_POR_DEFECTO);
  const sinHorarioPropio = (horarioData ?? []).length === 0;
  const profesionales = (profesionalesData ?? []) as { id: string; nombre: string; en_reserva_online: boolean }[];
  const servicios = (serviciosData ?? []).map((fila) => ({
    id: fila.id as string,
    nombre: fila.name as string,
    categoria: (fila.categoria as string | null) ?? null,
    duracion: (fila.duracion_min as number | null) ?? 30,
    precio: (fila.one_time_price as number | null) ?? null,
    descripcion: null,
    enLinea: fila.en_reserva_online !== false,
  }));
  const slugSugerido = configuracion.reserva_slug ?? normalizarSlug((organizacion?.slug as string | undefined) ?? empresa ?? "mi-clinica");
  const enlace = configuracion.reserva_slug ? enlaceDeReserva(configuracion.reserva_slug) : null;

  const deSeguimiento: ClavePlantilla[] = [
    "presupuesto",
    ...(tipo === "vet" ? (["vacuna", "control"] as ClavePlantilla[]) : []),
    ...(tipo === "dental" ? (["control"] as ClavePlantilla[]) : []),
    ...(tipo === "barber" ? (["mantencion"] as ClavePlantilla[]) : []),
  ];

  const editor = (clave: ClavePlantilla) => (
    <TextoPlantillaEditor
      key={clave}
      clave={clave}
      nombre={PLANTILLAS[clave].nombre}
      original={PLANTILLAS[clave].cuerpo}
      propio={configuracion.textos[clave] ?? null}
      variables={PLANTILLAS_EDITABLES[clave] ?? []}
      clinica={empresa ?? "tu clínica"}
      puedeEditar={puedeEditar}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurar la agenda"
        icon={Settings2}
        description="Horario, reserva en línea, cuándo sale el recordatorio y con qué palabras le escribe Atlas."
        actions={
          <Link href="/dashboard/citas" className={buttonClasses({ variant: "ghost" })}>
            <ArrowLeft size={16} aria-hidden="true" /> Volver a la agenda
          </Link>
        }
      />

      {!puedeEditar && <Callout tone="info">Puedes ver la configuración. Para cambiarla, pídeselo a un administrador.</Callout>}

      <nav aria-label="Secciones" className="flex flex-wrap gap-2 text-sm">
        {[
          ["#horario", "Horario"],
          ["#reserva", "Reserva en línea"],
          ["#recordatorio", "Recordatorio"],
          ["#mensajes", "Mensajes"],
          ["#consentimientos", "Consentimientos"],
        ].map(([href, texto]) => (
          <a key={href} href={href} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-muted-foreground hover:border-border-strong hover:text-foreground">
            {texto}
          </a>
        ))}
      </nav>

      <div id="horario" className="scroll-mt-20">
        <SectionCard
          title="Horario de atención"
          description={sinHorarioPropio ? "Todavía no lo has definido: la agenda ofrece lunes a viernes de 9 a 19 y sábado de 10 a 14." : "Las horas en que se puede reservar. Cada profesional puede tener el suyo."}
        >
          <ActionForm action={guardarHorarioEmpresa} success="Horario guardado: la reserva en línea ya ofrece estas horas" className="space-y-4">
            <HorarioSemanal inicial={horario} puedeEditar={puedeEditar} />
            {puedeEditar && (
              <div className="flex justify-end">
                <ActionSubmit variant="secondary" pendingLabel="Guardando…">Guardar horario</ActionSubmit>
              </div>
            )}
          </ActionForm>
        </SectionCard>
      </div>

      <div id="reserva" className="scroll-mt-20">
        <SectionCard
          title={<span className="flex items-center gap-2">Reserva en línea {configuracion.reserva_activa ? <Badge tone="success">Activa</Badge> : <Badge tone="neutral">Apagada</Badge>}</span>}
          description="Un enlace para Instagram, Google y tu web: la persona elige servicio, profesional y hora, y la cita aparece sola en la agenda."
        >
          <div className="space-y-6">
            {configuracion.reserva_activa && enlace && (
              <div className="space-y-3 rounded-lg border border-border bg-surface-muted/40 p-4">
                <p className="text-sm font-medium">Tu enlace</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-2 text-sm">{enlace}</code>
                  <CopiarTexto texto={enlace} etiqueta="Copiar enlace" />
                  <a href={enlace} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                    Abrir <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">Pégalo en la biografía de Instagram, en el botón «Reservar» de tu perfil de Google y en tus respuestas de WhatsApp.</p>
                <details className="text-sm">
                  <summary className="min-h-9 cursor-pointer py-1 font-medium text-muted-foreground hover:text-foreground">Ponerla dentro de tu web</summary>
                  <div className="mt-2 space-y-2">
                    <textarea readOnly rows={3} value={codigoParaWeb(configuracion.reserva_slug!)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" aria-label="Código para tu web" />
                    <CopiarTexto texto={codigoParaWeb(configuracion.reserva_slug!)} etiqueta="Copiar código" />
                  </div>
                </details>
              </div>
            )}

            <ActionForm action={guardarReservaEnLinea} success="Reserva en línea guardada" className="space-y-4">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
                <input type="checkbox" name="reserva_activa" value="si" defaultChecked={configuracion.reserva_activa} disabled={!puedeEditar} className="mt-0.5 size-4" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Recibir reservas en línea</span>
                  <span className="block text-xs text-muted-foreground">Las citas entran como «sin confirmar» y reciben el mismo recordatorio que pide confirmación.</span>
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Dirección del enlace">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <span className="hidden shrink-0 sm:inline">…/reservar/</span>
                    <Input name="reserva_slug" required defaultValue={slugSugerido} pattern="[a-z0-9-]{3,40}" disabled={!puedeEditar} />
                  </div>
                </Field>
                <Field label="Se puede reservar hasta">
                  <Select name="reserva_anticipacion_horas" defaultValue={String(configuracion.reserva_anticipacion_horas)} disabled={!puedeEditar}>
                    {OPCIONES_RESERVA.anticipacion.map((opcion) => <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>)}
                  </Select>
                </Field>
                <Field label="Agenda abierta para">
                  <Select name="reserva_dias" defaultValue={String(configuracion.reserva_dias)} disabled={!puedeEditar}>
                    {OPCIONES_RESERVA.dias.map((opcion) => <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>)}
                  </Select>
                </Field>
                <Field label="Horas que se ofrecen">
                  <Select name="reserva_intervalo_min" defaultValue={String(configuracion.reserva_intervalo_min)} disabled={!puedeEditar}>
                    {OPCIONES_RESERVA.intervalo.map((opcion) => <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Mensaje de bienvenida (opcional)">
                <Input name="reserva_mensaje" maxLength={400} defaultValue={configuracion.reserva_mensaje ?? ""} placeholder="Elige el servicio y la hora. Te confirmamos por WhatsApp." disabled={!puedeEditar} />
              </Field>
              {puedeEditar && (
                <div className="flex justify-end">
                  <ActionSubmit pendingLabel="Guardando…">Guardar reserva en línea</ActionSubmit>
                </div>
              )}
            </ActionForm>

            <ActionForm action={guardarOfertaEnLinea} success="Listo: la página de reserva ya muestra esto" className="space-y-4 border-t border-border pt-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">Quiénes reciben reservas</p>
                <div className="flex flex-wrap gap-2">
                  {profesionales.map((profesional) => (
                    <label key={profesional.id} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-sm">
                      <input type="hidden" name="profesional_visible" value={profesional.id} />
                      <input type="checkbox" name="profesional" value={profesional.id} defaultChecked={profesional.en_reserva_online} disabled={!puedeEditar} className="size-4" />
                      {profesional.nombre}
                    </label>
                  ))}
                </div>
              </div>
              <details className="space-y-2">
                <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">
                  Servicios que se pueden reservar <span className="font-normal text-muted-foreground">({servicios.filter((servicio) => servicio.enLinea).length} de {servicios.length})</span>
                </summary>
                <div className="mt-3 space-y-4">
                  {serviciosPorCategoria(servicios).map((grupo) => (
                    <fieldset key={grupo.categoria} className="space-y-1">
                      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo.categoria}</legend>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {grupo.servicios.map((servicio) => (
                          <label key={servicio.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                            <input type="hidden" name="servicio_visible" value={servicio.id} />
                            <input type="checkbox" name="servicio" value={servicio.id} defaultChecked={servicios.find((item) => item.id === servicio.id)?.enLinea} disabled={!puedeEditar} className="size-4" />
                            <span className="truncate">{servicio.nombre}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{servicio.duracion} min</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </details>
              {puedeEditar && (
                <div className="flex justify-end">
                  <ActionSubmit variant="secondary" pendingLabel="Guardando…">Guardar quiénes y qué</ActionSubmit>
                </div>
              )}
            </ActionForm>
          </div>
        </SectionCard>
      </div>

      <div id="recordatorio" className="scroll-mt-20">
      <SectionCard title="Recordatorio de cita" description={resumenRecordatorio(configuracion)}>
        <ActionForm action={guardarRecordatorios} success="Listo: los próximos recordatorios salen así" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="¿Cuándo sale?">
              <Select name="recordatorio_dias_antes" defaultValue={String(configuracion.recordatorio_dias_antes)} disabled={!puedeEditar}>
                {OPCIONES_ANTICIPACION.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
                ))}
              </Select>
            </Field>
            <Field label="Desde qué hora">
              <Select name="recordatorio_desde" defaultValue={configuracion.recordatorio_desde} disabled={!puedeEditar}>
                {HORAS_DE_ENVIO.map((hora) => (
                  <option key={hora} value={hora}>{hora}</option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
            <input
              type="checkbox"
              name="confirmacion_automatica"
              value="si"
              defaultChecked={configuracion.confirmacion_automatica}
              disabled={!puedeEditar}
              className="mt-0.5 size-4 accent-[var(--color-primary)]"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-foreground">La respuesta confirma o cancela sola</span>
              <span className="block text-xs text-muted-foreground">
                «Sí», «confirmo» o 👍 confirman la cita. «No» o «no puedo» la cancelan y liberan la hora. «Quiero cambiar la hora» deja una tarea para
                ofrecer otra. Lo que no queda claro (una pregunta, un mensaje largo) lo lee una persona en Conversaciones.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Si la cita se agenda cuando ya pasó el día del recordatorio, sale igual ese mismo día, siempre que falten más de 2 horas. Nunca sale
            después de las 21:00.
          </p>
          {puedeEditar && (
            <div className="flex justify-end">
              <ActionSubmit pendingLabel="Guardando…">Guardar recordatorio</ActionSubmit>
            </div>
          )}
        </ActionForm>
      </SectionCard>
      </div>

      <div id="consentimientos" className="scroll-mt-20">
        <SectionCard
          title="Consentimiento informado"
          description="Plantillas que se convierten en un documento de la ficha y se firman en pantalla o desde el celular. Usa {{nombre}}, {{rut}}, {{mascota}}, {{clinica}} y {{fecha}}."
          actions={
            puedeEditar ? (
              <CreatePanel label="Nueva plantilla" title="Nueva plantilla de consentimiento" description="Escríbela en lenguaje claro. Revísala con tu asesoría antes de usarla." action={crearPlantillaConsentimiento} submitLabel="Guardar plantilla" successLabel="Plantilla creada">
                <Field label="Título"><Input name="titulo" required placeholder={tipo === "vet" ? "Cirugía y anestesia" : tipo === "barber" ? "Decoloración" : "Endodoncia"} /></Field>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">Texto</span>
                  <textarea name="texto" required minLength={20} rows={10} className="rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm" placeholder="Yo, {{nombre}}, autorizo a {{clinica}} a…" />
                </label>
              </CreatePanel>
            ) : null
          }
        >
          <div className="space-y-3">
            {plantillasConsentimiento.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
                <p className="text-sm text-muted-foreground">
                  Todavía no hay plantillas. Puedes partir con {PLANTILLAS_SUGERIDAS[tipo].length} sugeridas para tu rubro ({PLANTILLAS_SUGERIDAS[tipo].map((plantilla) => plantilla.titulo.toLowerCase()).join(", ")}) y ajustarlas.
                </p>
                {puedeEditar && (
                  <ActionForm action={agregarPlantillasSugeridas} success="Plantillas agregadas: revísalas y ajústalas">
                    <ActionSubmit variant="secondary" pendingLabel="Agregando…">Agregar sugeridas</ActionSubmit>
                  </ActionForm>
                )}
              </div>
            )}
            {plantillasConsentimiento.map((plantilla) => (
              <details key={plantilla.id} className="group rounded-lg border border-border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{plantilla.titulo}</span>
                  {!plantilla.activo && <Badge tone="neutral">Inactiva</Badge>}
                  <span className="text-sm text-primary group-open:hidden">Editar</span>
                </summary>
                <ActionForm action={guardarPlantillaConsentimiento} success="Plantilla guardada" className="space-y-3 border-t border-border p-3">
                  <input type="hidden" name="id" value={plantilla.id} />
                  <Field label="Título"><Input name="titulo" required defaultValue={plantilla.titulo} disabled={!puedeEditar} /></Field>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium">Texto</span>
                    <textarea name="texto" required rows={10} defaultValue={plantilla.texto} disabled={!puedeEditar} className="rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm" />
                  </label>
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" name="activo" value="si" defaultChecked={plantilla.activo} disabled={!puedeEditar} className="size-4" /> Disponible para nuevos documentos
                  </label>
                  {puedeEditar && <div className="flex justify-end"><ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">Guardar</ActionSubmit></div>}
                </ActionForm>
              </details>
            ))}
            {plantillasConsentimiento.length > 0 && puedeEditar && (
              <ActionForm action={agregarPlantillasSugeridas} success="Listo: se agregaron las que faltaban">
                <ActionSubmit variant="ghost" size="sm" pendingLabel="Agregando…">Agregar las sugeridas que falten</ActionSubmit>
              </ActionForm>
            )}
          </div>
        </SectionCard>
      </div>

      <div id="mensajes" className="scroll-mt-20 space-y-5">
      <SectionCard
        title={<span className="flex items-center gap-2"><MessageSquareText size={16} aria-hidden="true" /> Mensajes de la cita</span>}
        description="El recordatorio y la respuesta que recibe la persona cuando contesta."
      >
        <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{MENSAJES_DE_CITA.map(editor)}</div>
      </SectionCard>

      <SectionCard title="Mensajes de seguimiento" description="Los que hacen volver: presupuestos sin respuesta y controles pendientes.">
        <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{deSeguimiento.map(editor)}</div>
      </SectionCard>
      </div>
    </div>
  );
}
