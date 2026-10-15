import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CheckCircle2, Circle, Pause, Play, Rocket, Send } from "lucide-react";

import { AudienciaBigdata } from "@/components/campanas-correo/audiencia-bigdata";
import { BotonDeAccion } from "@/components/campanas-correo/boton-de-accion";
import { EditorCorreos } from "@/components/campanas-correo/editor-correos";
import { GestionEnCrm } from "@/components/campanas-correo/gestion-en-crm";
import { Pasos, type PasoId } from "@/components/campanas-correo/pasos";
import { ProgramacionCampana } from "@/components/campanas-correo/programacion-campana";
import { PruebaCampana } from "@/components/campanas-correo/prueba-campana";
import { Badge, Callout, PageHeader, SectionCard, SegmentTabs } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import {
  ESTADO_CAMPANA,
  PROGRAMACION_POR_DEFECTO,
  coberturaDeCasilla,
  describirProgramacion,
  etiquetaDeAccion,
  formatearNumero,
  pendientesParaLanzar,
  porcentaje,
  type CampanaDetalle,
} from "@/lib/campanas-correo";
import { campanaDeCorreo, capacidadesDeCorreo, casillasDelCrm, empresaActual } from "@/lib/campanas-correo.server";
import { opcionesDeVinculo, vinculoDeCampanaDeCorreo } from "@/lib/vinculo-correo-crm.server";

// Una carga de audiencia o una prueba de 5 correos puede tomar más de un minuto.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type Tab = "resumen" | "correos" | "audiencia" | "programacion" | "actividad";
const TABS: Tab[] = ["resumen", "correos", "audiencia", "programacion", "actividad"];

function Cifra({ label, valor, detalle, href, accion }: { label: string; valor: string; detalle?: string; href?: string; accion?: string }) {
  const contenido = (
    <>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-[24px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{valor}</dd>
      {detalle && <p className="mt-2 text-xs text-muted-foreground">{detalle}</p>}
      {href && accion && <p className="mt-2 text-xs font-medium text-primary group-hover:underline">{accion} →</p>}
    </>
  );
  // Un indicador con gente detrás se pincha y lleva a la cola donde se asigna.
  return href ? (
    <Link href={href} className="group block bg-surface px-5 py-4 transition-colors hover:bg-surface-muted/55">
      {contenido}
    </Link>
  ) : (
    <div className="bg-surface px-5 py-4">{contenido}</div>
  );
}

function AccionesDeEstado({ campana, faltan, sinLector, gestion }: { campana: CampanaDetalle; faltan: string[]; sinLector: string | null; gestion: string | null }) {
  if (campana.estado === "borrador") {
    return (
      <BotonDeAccion
        accion={{ tipo: "estado", campanaId: campana.id, accion: "lanzar" }}
        exito="Campaña lanzada: sale según su programación"
        pendiente="Lanzando…"
        disabled={faltan.length > 0}
        title={faltan.length ? `Falta: ${faltan.join(", ").toLowerCase()}` : undefined}
        confirmar={{
          title: `¿Lanzar «${campana.nombre}»?`,
          description: (
            <>
              <p>
                Le escribe a {formatearNumero(campana.audiencia.total)} contactos desde {campana.remitente.email ?? campana.remitente.marca}.
              </p>
              <p className="mt-2">{describirProgramacion(campana.programacion ?? PROGRAMACION_POR_DEFECTO, campana.limite_diario)}</p>
              {gestion && <p className="mt-2">Quienes abran o respondan quedan en Correo, en {gestion}, para asignarlos.</p>}
              {sinLector && (
                <p className="mt-2 font-medium text-danger">
                  Ojo: nadie lee {sinLector}, la casilla a la que responden los clientes. Sus respuestas no llegarán al CRM hasta que la conectes.
                </p>
              )}
              <p className="mt-2">Puedes pausarla cuando quieras; lo que ya salió no se puede retirar.</p>
            </>
          ),
          confirmLabel: "Lanzar campaña",
          tone: "primary",
        }}
      >
        <Rocket size={16} aria-hidden="true" /> Lanzar campaña
      </BotonDeAccion>
    );
  }
  if (campana.estado === "pausada") {
    return (
      <BotonDeAccion accion={{ tipo: "estado", campanaId: campana.id, accion: "reanudar" }} exito="Campaña reanudada" pendiente="Reanudando…">
        <Play size={16} aria-hidden="true" /> Reanudar
      </BotonDeAccion>
    );
  }
  if (["enviando", "en_espera", "programada"].includes(campana.estado)) {
    return (
      <BotonDeAccion variant="secondary" accion={{ tipo: "estado", campanaId: campana.id, accion: "pausar" }} exito="Campaña pausada: no sale nada hasta que la reanudes" pendiente="Pausando…">
        <Pause size={16} aria-hidden="true" /> Pausar
      </BotonDeAccion>
    );
  }
  return null;
}

export default async function CampanaCorreoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await connection();
  const perfil = await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const empresa = await empresaActual();
  if (!empresa) redirect("/dashboard/campanas-correo");

  const [detalle, capacidades] = await Promise.all([campanaDeCorreo(empresa.slug, id), capacidadesDeCorreo(empresa.slug)]);
  if (!detalle.ok) {
    if (detalle.status === 404) notFound();
    return <Callout tone="danger">No se pudo leer la campaña: {detalle.error}. Vuelve a cargar para reintentar.</Callout>;
  }
  // Atlas Lead puede ir una versión atrás durante un despliegue: lo nuevo es opcional.
  const campana = { ...detalle.datos.campana, respuestas: detalle.datos.campana.respuestas ?? [] };
  const limites = capacidades.ok ? capacidades.datos.limites : { imagenMb: 5, pruebaMax: 5, pasosMax: 5, audienciaLoteMax: 500, limiteDiarioMax: 1000 };
  const variables = capacidades.ok ? capacidades.datos.variables : [];

  const [vinculo, opcionesCrm] = await Promise.all([vinculoDeCampanaDeCorreo(campana.id), opcionesDeVinculo(empresa.id)]);
  const sugerida = opcionesCrm.sugerencia ? opcionesCrm.campanas.find((item) => item.id === opcionesCrm.sugerencia?.campaignId) : undefined;
  const gestion = vinculo ? vinculo.campaignName : (sugerida?.nombre ?? null);
  const faltan = pendientesParaLanzar(campana);
  // Sin campaña del CRM que la reciba, lo que la campaña genere no tiene dónde gestionarse.
  if (!gestion) faltan.push("Elegir la campaña del CRM que la atiende");
  // ¿Alguien lee la casilla a la que responden los clientes de esta campaña?
  const casillaRespuesta = (campana.remitente.responder_a ?? campana.remitente.email ?? "").trim().toLowerCase().replace(/\+[^@]*@/, "@");
  const casilla = capacidades.ok ? (capacidades.datos.casillas_respuesta ?? []).find((item) => item.direccion === casillaRespuesta) : undefined;
  const sinLector = casilla && coberturaDeCasilla(casilla, await casillasDelCrm(empresa.id)).estado === "nadie" ? casilla.direccion : null;
  const borrador = campana.estado === "borrador";
  const cancelada = campana.estado === "cancelada";
  const { tab: tabPedida } = await searchParams;
  const tab: Tab = TABS.includes(tabPedida as Tab) ? (tabPedida as Tab) : "resumen";
  const estado = ESTADO_CAMPANA[campana.estado] ?? ESTADO_CAMPANA.borrador;
  const base = `/dashboard/campanas-correo/${campana.id}`;
  const m = campana.metricas;
  // La cola de Correo filtrada por esta campaña: ahí se ve quién abrió y se asigna en bloque.
  const colaDeCorreo = vinculo ? `/dashboard/mail?mailCampaign=${vinculo.mailCampaignId}` : undefined;

  const hechos: PasoId[] = [];
  if (campana.contenido.pasos.length) hechos.push("correos");
  if (campana.audiencia.total) hechos.push("audiencia");
  if (campana.programacion) hechos.push("programacion");
  const pasoActual: PasoId = tab === "correos" || tab === "audiencia" || tab === "programacion" ? tab : "lanzar";

  const bloqueoCorreos = cancelada
    ? "La campaña está cancelada."
    : !campana.contenido.editable
      ? "Esta campaña se armó en la consola de Atlas Lead con pasos que este editor no muestra (fechas u horarios por correo). Sus correos se editan allá; desde acá puedes ajustar la programación, la audiencia y el estado."
      : campana.activa
        ? "La campaña está enviando. Páusala para cambiar los correos; la programación y el límite diario se ajustan sin pausar."
        : null;

  return (
    <div className="space-y-5">
      <Link href="/dashboard/campanas-correo" className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} aria-hidden="true" /> Campañas de correo
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {campana.nombre}
            <Badge tone={estado.tone}>{estado.label}</Badge>
          </span>
        }
        icon={Send}
        description={`${campana.remitente.marca}${campana.remitente.email ? ` · ${campana.remitente.email}` : ""} · ${estado.ayuda}`}
        actions={<AccionesDeEstado campana={campana} faltan={faltan} sinLector={sinLector} gestion={gestion} />}
      />

      {sinLector && !["cancelada", "terminada"].includes(campana.estado) && (
        <Callout tone="danger">
          Nadie lee <strong>{sinLector}</strong>, la casilla a la que responden los clientes de esta campaña: sus respuestas no llegarán al CRM ni detendrán la
          secuencia. Para leerla solo falta su clave:{" "}
          <Link href={`/dashboard/admin/correo?conectar=${encodeURIComponent(sinLector)}#conectar`} className="font-medium underline">
            conectar {sinLector}
          </Link>
          .
        </Callout>
      )}

      {!vinculo && !borrador && !cancelada && (
        <Callout tone="danger">
          Esta campaña no está conectada al CRM: quienes la abren o responden no aparecen en Correo ni se pueden asignar. Conéctala en «Gestión en el CRM»; se trae también
          lo que ya pasó.
        </Callout>
      )}

      {borrador && <Pasos actual={pasoActual} hechos={hechos} base={base} />}

      <div className="border-b border-border">
        <SegmentTabs
          label="Secciones de la campaña"
          activeId={tab}
          tabs={[
            { id: "resumen", label: borrador ? "Revisar y lanzar" : "Resumen", href: base },
            { id: "correos", label: "Correos", href: `${base}?tab=correos`, count: campana.contenido.pasos.length },
            { id: "audiencia", label: "Audiencia", href: `${base}?tab=audiencia`, count: campana.audiencia.total },
            { id: "programacion", label: "Cuándo envía", href: `${base}?tab=programacion` },
            { id: "actividad", label: "Actividad", href: `${base}?tab=actividad`, count: campana.acciones.length },
          ]}
        />
      </div>

      {tab === "resumen" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            {borrador ? (
              <SectionCard title={faltan.length ? `Te ${faltan.length === 1 ? "falta 1 paso" : `faltan ${faltan.length} pasos`} para lanzar` : "Lista para lanzar"} description="Revisa, manda una prueba y lánzala. Sale solo dentro de su horario.">
                <ul className="divide-y divide-border border-t border-border">
                  {[
                    { listo: campana.contenido.pasos.length > 0, texto: campana.contenido.pasos.length ? `${campana.contenido.pasos.length} ${campana.contenido.pasos.length === 1 ? "correo" : "correos"} escritos` : "Escribir al menos un correo", href: `${base}?tab=correos` },
                    { listo: campana.audiencia.total > 0, texto: campana.audiencia.total ? `${formatearNumero(campana.audiencia.total)} contactos en la audiencia` : "Cargar la audiencia desde Bigdata", href: `${base}?tab=audiencia` },
                    { listo: Boolean(campana.programacion), texto: campana.programacion ? describirProgramacion(campana.programacion, campana.limite_diario) : "Sin horario propio: saldrá de lunes a viernes, de 9 a 18 h. Puedes cambiarlo", href: `${base}?tab=programacion` },
                  ].map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="flex min-h-12 items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-muted/55">
                        {item.listo ? <CheckCircle2 size={18} className="mt-px shrink-0 text-success" aria-hidden="true" /> : <Circle size={18} className="mt-px shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <span className={item.listo ? "text-sm text-foreground" : "text-sm font-medium text-foreground"}>{item.texto}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : (
              <>
                <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                  <Cifra label="Contactados" valor={formatearNumero(m?.contactados)} detalle={m?.base ? `de ${formatearNumero(m.base)} en la audiencia` : undefined} />
                  <Cifra label="Abrieron" valor={m ? porcentaje(m.abrieron, m.contactados) : "—"} detalle={`${formatearNumero(m?.abrieron)} personas`} href={m?.abrieron ? colaDeCorreo : undefined} accion="Ver y asignar" />
                  <Cifra label="Hicieron clic" valor={m ? porcentaje(m.clics, m.contactados) : "—"} detalle={`${formatearNumero(m?.clics)} personas`} href={m?.clics && colaDeCorreo ? `${colaDeCorreo}&queue=clicked_uncontacted` : undefined} accion="Clic sin gestión" />
                  <Cifra label="Respondieron" valor={formatearNumero(m?.respuestas)} detalle="Llegan a la bandeja de Correo" href={m?.respuestas && colaDeCorreo ? `${colaDeCorreo}&queue=customer_replied` : undefined} accion="Por responder" />
                  <Cifra label="Se dieron de baja" valor={formatearNumero(m?.bajas)} detalle={m?.contactados ? porcentaje(m.bajas, m.contactados) : undefined} />
                  <Cifra label="Rebotaron" valor={formatearNumero(m?.rebotes)} detalle={m?.contactados ? porcentaje(m.rebotes, m.contactados) : undefined} />
                </dl>
                <SectionCard
                  title={`Respuestas${campana.respuestas.length ? ` · ${campana.respuestas.length}` : ""}`}
                  description="Lo que contestaron los clientes. También llegan a la bandeja de Correo para seguirlas."
                  actions={
                    <Link href={colaDeCorreo ?? "/dashboard/mail"} className="text-sm text-primary hover:underline">
                      Abrir bandeja
                    </Link>
                  }
                >
                  {campana.respuestas.length === 0 ? (
                    <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">Todavía nadie contestó esta campaña.</p>
                  ) : (
                    <ul className="divide-y divide-border/70 border-t border-border">
                      {campana.respuestas.map((respuesta) => (
                        <li key={respuesta.id} className="px-5 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {respuesta.empresa ?? respuesta.email}
                              {respuesta.empresa && respuesta.email ? <span className="font-normal text-muted-foreground"> · {respuesta.email}</span> : null}
                            </p>
                            <time className="text-xs tabular-nums text-muted-foreground" dateTime={respuesta.recibida_at}>
                              {cuando.format(new Date(respuesta.recibida_at)).replace(".", "")}
                            </time>
                          </div>
                          <p className="mt-0.5 text-sm text-foreground">{respuesta.asunto}</p>
                          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{respuesta.extracto}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
                <SectionCard title="Cuándo envía" description={campana.programacion ? describirProgramacion(campana.programacion, campana.limite_diario) : "Con el horario fijo de Atlas Lead (lunes a viernes). Puedes darle uno propio."}>
                  <div className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
                    {m?.ultimo_envio ? `Último envío: ${cuando.format(new Date(m.ultimo_envio)).replace(".", "")} · ${formatearNumero(m.enviados_24h)} en las últimas 24 horas.` : "Todavía no sale ningún correo."}{" "}
                    <Link href={`${base}?tab=programacion`} className="text-primary hover:underline">
                      Cambiar
                    </Link>
                  </div>
                </SectionCard>
              </>
            )}
          </div>
          <aside className="space-y-5">
            {!cancelada && (
              <SectionCard title="Gestión en el CRM">
                <div className="border-t border-border px-5 py-4">
                  <GestionEnCrm campanaId={campana.id} vinculo={vinculo} opciones={opcionesCrm} borrador={borrador} />
                </div>
              </SectionCard>
            )}
            {!cancelada && (
              <SectionCard title="Enviar una prueba">
                <div className="border-t border-border px-5 py-4">
                  <PruebaCampana campanaId={campana.id} correoInicial={perfil.email} maximo={limites.pruebaMax} pasos={Math.max(1, campana.contenido.pasos.length)} />
                </div>
              </SectionCard>
            )}
            {!cancelada && (
              // Lejos del primario: cancelar no se deshace.
              <div className="rounded-xl border border-border px-5 py-4">
                <p className="text-sm font-medium text-foreground">Cancelar la campaña</p>
                <p className="mt-1 text-xs text-muted-foreground">Deja de enviar para siempre. Si solo quieres detenerla un tiempo, pausa.</p>
                <BotonDeAccion
                  variant="ghost"
                  size="sm"
                  className="mt-3"
                  accion={{ tipo: "estado", campanaId: campana.id, accion: "cancelar" }}
                  exito="Campaña cancelada"
                  pendiente="Cancelando…"
                  confirmar={{
                    title: `¿Cancelar «${campana.nombre}»?`,
                    description: "No vuelve a salir ningún correo de esta campaña y no se puede reanudar. Lo enviado y sus métricas quedan.",
                    confirmLabel: "Cancelar campaña",
                    tone: "danger",
                  }}
                >
                  Cancelar campaña
                </BotonDeAccion>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "correos" && (
        <EditorCorreos
          modo="editar"
          campanaId={campana.id}
          version={campana.version}
          remitentes={[]}
          variables={variables}
          maxPasos={limites.pasosMax}
          imagenMb={limites.imagenMb}
          cabeceraConTexto={campana.remitente_cabecera_con_texto}
          bloqueo={bloqueoCorreos}
          inicial={{
            nombre: campana.nombre,
            limiteDiario: campana.limite_diario,
            ctaUrl: campana.cta_url,
            ctaTexto: campana.cta_texto,
            cabecera: campana.contenido.cabecera,
            pasos: campana.contenido.pasos,
          }}
        />
      )}

      {tab === "audiencia" && (
        <AudienciaBigdata campanaId={campana.id} nombreCampana={campana.nombre} audienciaActual={campana.audiencia} deshabilitado={cancelada ? "La campaña está cancelada." : null} />
      )}

      {tab === "programacion" && (
        <ProgramacionCampana campanaId={campana.id} version={campana.version} inicial={campana.programacion} limiteDiario={campana.limite_diario} deshabilitado={cancelada ? "La campaña está cancelada." : null} />
      )}

      {tab === "actividad" && (
        <SectionCard title="Actividad" description="Quién hizo qué con la campaña, persona o agente.">
          {campana.acciones.length === 0 ? (
            <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">Sin actividad registrada todavía.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {campana.acciones.map((accion, indice) => (
                <li key={indice} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                  <span className="text-sm text-foreground">
                    {etiquetaDeAccion(accion.accion)}
                    <span className="text-muted-foreground"> · {accion.actor?.nombre ?? (accion.actor?.tipo === "agente" ? "Agente" : "Persona")}</span>
                  </span>
                  <time className="text-xs tabular-nums text-muted-foreground" dateTime={accion.created_at}>
                    {cuando.format(new Date(accion.created_at)).replace(".", "")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
