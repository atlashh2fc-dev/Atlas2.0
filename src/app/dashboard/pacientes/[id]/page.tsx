import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import {
  CalendarClock,
  FileText,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  PhoneMissed,
  Syringe,
  Users,
} from "lucide-react";

import { agregarNota, registrarCuidado } from "@/app/actions/pacientes";
import { crearOportunidad } from "@/app/actions/ventas";
import { CreatePanel } from "@/components/create-panel";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
  buttonClasses,
} from "@/components/ui";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
import { ETIQUETA_VACUNA, edad, estadoVacuna } from "@/lib/mascotas";
import { denticionPorEdad, type RegistroOdontograma } from "@/lib/odontograma";
import { costoDeReceta, porCategoria, type Atencion, type Insumo, type Procedimiento } from "@/lib/arancel";
import { InsumosProvider } from "@/components/insumos-context";
import type { Estudio } from "@/lib/estudios";
import { Odontograma } from "@/components/odontograma/odontograma";
import { FichaMascota3D, type MascotaFicha, type RegistroMascota } from "@/components/mascota3d/ficha-mascota-3d";
import { contextoDeMiEmpresa, puedeLeerConversaciones } from "@/lib/modules.server";
import { REPORT_TIME_ZONE } from "@/lib/report-range";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Ficha del paciente (o del tutor).
 *
 * Arriba quién es y qué se puede hacer con él: presupuestar, escribirle por
 * WhatsApp o por correo. Al centro, lo que importa para venderle: sus
 * presupuestos y, en Vet, sus mascotas con el semáforo de vacunas; en Dental,
 * el odontograma 3D con la historia de cada pieza. Y una sola línea de tiempo
 * con todo lo que pasó: notas, llamadas, mensajes y cambios de etapa.
 */

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dia = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

const ORIGEN: Record<string, string> = {
  instagram: "Instagram",
  google: "Google",
  whatsapp: "WhatsApp",
  referido: "Referido",
  convenio: "Convenio",
  web: "Sitio web",
};

const LLAMADA: Record<string, string> = {
  connected: "Llamada contestada",
  no_answer: "Llamada sin respuesta",
  voicemail: "Llamada a buzón de voz",
  busy: "Línea ocupada",
  out_of_service: "Número fuera de servicio",
};

type Evento = {
  at: string;
  tipo: "nota" | "llamada" | "whatsapp" | "correo" | "reunion" | "etapa" | "mensaje_entrante" | "mensaje_saliente" | "llamada_fallida";
  titulo: string;
  detalle?: string | null;
  quien?: string | null;
};

const ICONO: Record<Evento["tipo"], typeof NotebookPen> = {
  nota: NotebookPen,
  llamada: Phone,
  llamada_fallida: PhoneMissed,
  whatsapp: MessageCircle,
  correo: Mail,
  reunion: Users,
  etapa: FileText,
  mensaje_entrante: MessageCircle,
  mensaje_saliente: MessageCircle,
};

function fechaCorta(valor: string | null): string {
  return valor ? dia.format(new Date(`${valor}T12:00:00Z`)) : "—";
}

export default async function FichaPacientePage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  const [{ edicion }, leeConversaciones] = await Promise.all([contextoDeMiEmpresa(), puedeLeerConversaciones(profile.role)]);
  const clinica = edicion === "vet" ? "vet" : "dental";
  const voc = PACIENTES_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const esVet = clinica === "vet";
  const supabase = await createClient();

  const { data: ficha } = await supabase
    .from("sales_companies")
    .select("id, organization_id, name, rut, phone, email, commune, source, metadata, created_at, sales_contacts(lead_id, phone, email)")
    .eq("id", id)
    .maybeSingle();
  if (!ficha) notFound();

  const leadIds = ((ficha.sales_contacts ?? []) as { lead_id: string | null }[])
    .map((contacto) => contacto.lead_id)
    .filter((valor): valor is string => Boolean(valor));

  const [
    { data: negocios },
    { data: mascotas },
    { data: productos },
    { data: personas },
    { data: llamadas },
    { data: conversaciones },
    { data: odontograma },
    { data: atencionesData },
    { data: registrosMascota },
    { data: estudiosData },
    { data: insumosData },
  ] =
    await Promise.all([
      supabase
        .from("sales_opportunities")
        .select("id, name, status, one_time_amount, monthly_amount, next_action_at, next_action_note, created_at, closed_at, lost_reason, sales_stages(name)")
        .eq("company_id", id)
        .order("created_at", { ascending: false }),
      esVet
        ? supabase.from("mascotas").select("*").eq("cuenta_id", id).order("created_at")
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      supabase
        .from("sales_products")
        .select("id, code, name, one_time_price, categoria, duracion_min, es_urgencia, aplica_a, resultado_odontograma, orden, active, receta:procedimiento_insumos(insumo_id, cantidad)")
        .eq("active", true)
        .order("orden")
        .order("name"),
      supabase.from("profiles").select("id, full_name"),
      leadIds.length > 0
        ? supabase.from("calls").select("id, status, reason, started_at, ended_at, agent_id").in("lead_id", leadIds).order("started_at", { ascending: false }).limit(30)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      leadIds.length > 0
        ? supabase.from("whatsapp_conversations").select("id, status, last_message_at").in("lead_id", leadIds).order("last_message_at", { ascending: false })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      !esVet
        ? supabase
            .from("odontograma_registros")
            .select("id, pieza, superficies, estado, avance, sintoma, diagnostico, tratamiento, profesional, nota, fecha, created_at")
            .eq("cuenta_id", id)
            .order("fecha", { ascending: false })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      supabase
        .from("atenciones")
        .select(
          "id, descripcion, pieza, superficies, region, mascota_id, precio, pagado, es_urgencia, profesional, nota, fecha, created_at, costo_materiales, precio_materiales, atencion_insumos(nombre, unidad, cantidad, costo_unitario, precio_unitario, cobrado)",
        )
        .eq("cuenta_id", id)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false }),
      esVet
        ? supabase
            .from("mascota_registros")
            .select("id, mascota_id, region, punto, tipo, titulo, detalle, avance, profesional, fecha, created_at")
            .eq("cuenta_id", id)
            .order("fecha", { ascending: false })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      supabase
        .from("estudios_clinicos")
        .select("id, tipo, titulo, nota, pieza, region, mascota_id, mime, tamano, fecha, storage_path")
        .eq("cuenta_id", id)
        .order("fecha", { ascending: false }),
      supabase
        .from("insumos")
        .select("id, codigo, nombre, categoria, unidad, costo, precio_venta, cobrable, stock, stock_minimo, activo")
        .eq("activo", true)
        .order("categoria")
        .order("nombre"),
    ]);

  // Los estudios se ven con enlaces firmados que expiran en una hora.
  const rutas = ((estudiosData ?? []) as { storage_path: string }[]).map((estudio) => estudio.storage_path);
  const { data: firmados } = rutas.length > 0
    ? await supabase.storage.from("estudios-clinicos").createSignedUrls(rutas, 60 * 60)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const enlace = new Map((firmados ?? []).map((firmado) => [firmado.path, firmado.signedUrl]));
  const estudios = ((estudiosData ?? []) as (Omit<Estudio, "url"> & { storage_path: string })[]).map(({ storage_path, ...estudio }) => ({
    ...estudio,
    url: enlace.get(storage_path) ?? null,
  }));

  const opportunityIds = (negocios ?? []).map((negocio) => negocio.id as string);
  const conversacionIds = (conversaciones ?? []).map((conversacion) => conversacion.id as string);
  const [{ data: actividades }, { data: mensajes }] = await Promise.all([
    supabase
      .from("sales_activities")
      .select("kind, subject, body, occurred_at, owner_id")
      .or(opportunityIds.length > 0 ? `company_id.eq.${id},opportunity_id.in.(${opportunityIds.join(",")})` : `company_id.eq.${id}`)
      .order("occurred_at", { ascending: false })
      .limit(60),
    leeConversaciones && conversacionIds.length > 0
      ? supabase
          .from("whatsapp_messages")
          .select("direction, text_body, created_at, sent_by")
          .in("conversation_id", conversacionIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const nombre = new Map((personas ?? []).map((persona) => [persona.id as string, persona.full_name as string]));
  const metadata = (ficha.metadata ?? {}) as Record<string, unknown>;
  const texto = (clave: string) => (typeof metadata[clave] === "string" && metadata[clave] ? (metadata[clave] as string) : null);
  const edadPaciente = edad(texto("nacimiento"));
  const telefono = (ficha.phone ?? "").replace(/\D/g, "");
  const abiertos = (negocios ?? []).filter((negocio) => negocio.status === "abierta");
  const registrosOdontograma = (odontograma ?? []) as unknown as RegistroOdontograma[];
  const arancel = (productos ?? []) as unknown as Procedimiento[];
  const atenciones = (atencionesData ?? []) as unknown as Atencion[];
  const insumos = (insumosData ?? []) as unknown as Insumo[];
  const insumoPorId = new Map(insumos.map((insumo) => [insumo.id, insumo]));
  // Los profesionales que aparecen en la clínica: el tratante del paciente primero.
  const profesionales = [
    ...new Set(
      [
        texto("profesional"),
        ...registrosOdontograma.map((registro) => registro.profesional),
        ...((registrosMascota ?? []) as { profesional: string | null }[]).map((registro) => registro.profesional),
      ].filter((valor): valor is string => Boolean(valor)),
    ),
  ];

  const eventos: Evento[] = [
    ...(actividades ?? []).map((actividad) => ({
      at: actividad.occurred_at as string,
      tipo: (["nota", "llamada", "whatsapp", "correo", "reunion", "etapa"].includes(actividad.kind as string) ? actividad.kind : "nota") as Evento["tipo"],
      titulo: actividad.subject as string,
      detalle: actividad.body as string | null,
      quien: actividad.owner_id ? nombre.get(actividad.owner_id as string) : null,
    })),
    ...(llamadas ?? []).map((llamada) => {
      const segundos = llamada.ended_at && llamada.started_at
        ? Math.round((new Date(llamada.ended_at as string).getTime() - new Date(llamada.started_at as string).getTime()) / 1000)
        : null;
      return {
        at: llamada.started_at as string,
        tipo: (llamada.status === "connected" ? "llamada" : "llamada_fallida") as Evento["tipo"],
        titulo: LLAMADA[llamada.status as string] ?? "Llamada",
        detalle: [llamada.reason ? String(llamada.reason).toLowerCase() : null, segundos && llamada.status === "connected" ? `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")} min` : null]
          .filter(Boolean)
          .join(" · "),
        quien: llamada.agent_id ? nombre.get(llamada.agent_id as string) : null,
      };
    }),
    ...(mensajes ?? []).map((mensaje) => ({
      at: mensaje.created_at as string,
      tipo: (mensaje.direction === "inbound" ? "mensaje_entrante" : "mensaje_saliente") as Evento["tipo"],
      titulo: mensaje.direction === "inbound" ? `${ficha.name.split(" ")[0]} escribió por WhatsApp` : "Respuesta por WhatsApp",
      detalle: mensaje.text_body as string | null,
      quien: mensaje.sent_by ? nombre.get(mensaje.sent_by as string) : null,
    })),
  ]
    .filter((evento) => evento.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);

  const datos: [string, string | null][] = [
    ["RUT", ficha.rut],
    ["Celular", ficha.phone],
    ["Correo", ficha.email],
    ["Comuna", ficha.commune],
    ...(!esVet
      ? ([
          ["Previsión", texto("prevision")],
          ["Edad", edadPaciente],
          ["Profesional", texto("profesional")],
        ] as [string, string | null][])
      : ([["Veterinario", texto("profesional")]] as [string, string | null][])),
    ["Cómo llegó", ficha.source ? ORIGEN[ficha.source] ?? ficha.source : null],
    ["Ficha desde", fechaCorta((ficha.created_at as string).slice(0, 10))],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={ficha.name}
        description={[
          voc.singular,
          !esVet && texto("prevision"),
          !esVet && edadPaciente,
          esVet && `${(mascotas ?? []).length} ${(mascotas ?? []).length === 1 ? "mascota" : "mascotas"}`,
          abiertos.length > 0 && `${abiertos.length} ${ventas.negocio.toLowerCase()} abierto`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CreatePanel
              label={ventas.nuevo}
              title={`${ventas.nuevo} para ${ficha.name.split(" ")[0]}`}
              description="El monto sale del arancel más los materiales que se cobran aparte, salvo que escribas otro."
              action={crearOportunidad}
              submitLabel={ventas.nuevo.replace(/^Nuev[oa] /, "Crear ")}
              successLabel={`${ventas.negocio} creado`}
            >
              <input type="hidden" name="empresa" value={ficha.name} />
              <input type="hidden" name="con_materiales" value="si" />
              {ficha.rut && <input type="hidden" name="rut" value={ficha.rut} />}
              <Field label={ventas.negocio}>
                <Input name="nombre" required placeholder={ventas.negocioPlaceholder} data-autofocus />
              </Field>
              <Field label={ventas.producto}>
                <Select name="producto" defaultValue="">
                  <option value="">Sin {ventas.producto.toLowerCase()} del catálogo</option>
                  {porCategoria(arancel).map(([categoria, items]) => (
                    <optgroup key={categoria} label={categoria}>
                      {items.map((producto) => {
                        const { cobro } = costoDeReceta(producto, insumoPorId);
                        return (
                          <option key={producto.code} value={producto.code}>
                            {producto.name}
                            {producto.one_time_price ? ` · ${pesos.format(Number(producto.one_time_price) + cobro)}` : ""}
                            {cobro > 0 ? " con materiales" : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Monto del presupuesto (vacío = arancel + materiales)">
                <Input name="monto_unico" inputMode="numeric" placeholder="1350000" />
              </Field>
              <Field label="Cierre estimado">
                <Input name="cierre_estimado" type="date" />
              </Field>
            </CreatePanel>
            {telefono.length >= 11 && (
              <a className={buttonClasses({ variant: "secondary" })} href={`https://wa.me/${telefono}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </a>
            )}
            {ficha.email && (
              <a className={buttonClasses({ variant: "secondary" })} href={`mailto:${ficha.email}`}>
                <Mail size={16} aria-hidden="true" /> Correo
              </a>
            )}
            {leeConversaciones && conversacionIds[0] && (
              <Link
                className={buttonClasses({ variant: "ghost" })}
                href={`/dashboard/conversaciones/whatsapp?conversation=${conversacionIds[0]}&status=all`}
              >
                Ver conversación
              </Link>
            )}
          </div>
        }
      />

      <Link href="/dashboard/pacientes" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Volver a {voc.titulo.toLowerCase()}
      </Link>

      <InsumosProvider insumos={insumos}>
      {esVet && (
        <FichaMascota3D
          cuentaId={id}
          mascotas={(mascotas ?? []) as unknown as MascotaFicha[]}
          registros={(registrosMascota ?? []) as unknown as RegistroMascota[]}
          atenciones={atenciones}
          arancel={arancel}
          profesionales={profesionales}
          estudios={estudios}
          organizationId={ficha.organization_id as string}
        />
      )}

      {!esVet && (
        <Odontograma
          cuentaId={id}
          registros={registrosOdontograma}
          denticionSugerida={denticionPorEdad(texto("nacimiento"))}
          edad={edadPaciente}
          profesionales={profesionales}
          arancel={arancel}
          atenciones={atenciones}
          estudios={estudios}
          organizationId={ficha.organization_id as string}
        />
      )}
      </InsumosProvider>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {esVet && (
            <SectionCard title="Mascotas" description="El semáforo es la próxima vacuna: vencida, por vencer en 30 días o al día.">
              {(mascotas ?? []).length === 0 ? (
                <EmptyState title="Sin mascotas registradas" description="Se agregan al crear la ficha del tutor." />
              ) : (
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  {(mascotas ?? []).map((mascota) => {
                    const estado = estadoVacuna(mascota.proxima_vacuna as string | null);
                    const tono = estado === "vencida" ? "danger" : estado === "por_vencer" ? "warning" : estado === "al_dia" ? "success" : "neutral";
                    return (
                      <div key={mascota.id as string} className="rounded-lg border border-border bg-surface p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-base font-semibold text-foreground">{mascota.nombre as string}</p>
                            <p className="text-xs text-muted-foreground">
                              {[mascota.especie, mascota.raza, mascota.sexo, edad(mascota.nacimiento as string | null)].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <Badge tone={tono}>{ETIQUETA_VACUNA[estado]}</Badge>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Próxima vacuna</dt>
                          <dd className="text-right font-medium text-foreground">{fechaCorta(mascota.proxima_vacuna as string | null)}</dd>
                          <dt className="text-muted-foreground">Desparasitación</dt>
                          <dd className="text-right text-foreground">{fechaCorta(mascota.proxima_desparasitacion as string | null)}</dd>
                          <dt className="text-muted-foreground">Peso</dt>
                          <dd className="text-right text-foreground">{mascota.peso_kg ? `${mascota.peso_kg} kg` : "—"}</dd>
                          <dt className="text-muted-foreground">Esterilizado</dt>
                          <dd className="text-right text-foreground">{mascota.esterilizado ? "Sí" : "No"}</dd>
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(["vacuna", "desparasitacion"] as const).map((tipo) => (
                            <ActionForm
                              key={tipo}
                              action={registrarCuidado}
                              success={tipo === "vacuna" ? "Vacuna registrada" : "Desparasitación registrada"}
                            >
                              <input type="hidden" name="mascota_id" value={mascota.id as string} />
                              <input type="hidden" name="cuenta_id" value={id} />
                              <input type="hidden" name="tipo" value={tipo} />
                              <ActionSubmit variant="secondary" size="sm">
                                <Syringe size={14} aria-hidden="true" /> {tipo === "vacuna" ? "Registrar vacuna" : "Desparasitación"}
                              </ActionSubmit>
                            </ActionForm>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard title={ventas.negocios} description={`Todo lo presupuestado a ${ficha.name.split(" ")[0]}, del más reciente al más antiguo.`}>
            {(negocios ?? []).length === 0 ? (
              <EmptyState title={`Sin ${ventas.negocios.toLowerCase()}`} description={`Crea el primero con "${ventas.nuevo}".`} />
            ) : (
              <ul className="divide-y divide-border">
                {(negocios ?? []).map((negocio) => {
                  const etapa = Array.isArray(negocio.sales_stages) ? negocio.sales_stages[0] : negocio.sales_stages;
                  const vencida = negocio.status === "abierta" && negocio.next_action_at && new Date(negocio.next_action_at) < new Date();
                  return (
                    <li key={negocio.id}>
                      <Link href={`/dashboard/ventas/${negocio.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{negocio.name}</p>
                          <p className={`truncate text-xs ${vencida ? "text-danger" : "text-muted-foreground"}`}>
                            {negocio.status === "abierta"
                              ? negocio.next_action_at
                                ? `${vencida ? "Vencida · " : "Próxima acción · "}${cuando.format(new Date(negocio.next_action_at))}${negocio.next_action_note ? ` · ${negocio.next_action_note}` : ""}`
                                : "Sin próxima acción"
                              : negocio.status === "perdida"
                                ? `No aceptado${negocio.lost_reason ? ` · ${negocio.lost_reason}` : ""}`
                                : `Aceptado${negocio.closed_at ? ` el ${cuando.format(new Date(negocio.closed_at))}` : ""}`}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular-nums text-foreground">{pesos.format(Number(negocio.one_time_amount ?? 0))}</p>
                        <Badge tone={negocio.status === "ganada" ? "success" : negocio.status === "perdida" ? "danger" : "info"}>
                          {(etapa as { name?: string } | null)?.name ?? negocio.status}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Historia" description="Notas, llamadas, mensajes y cambios de etapa en una sola línea de tiempo.">
            {eventos.length === 0 ? (
              <EmptyState title="Sin historia todavía" description="Lo que registres aparece acá." />
            ) : (
              <ol className="relative space-y-4 px-4 py-4">
                {eventos.map((evento, indice) => {
                  const Icono = ICONO[evento.tipo];
                  const entrante = evento.tipo === "mensaje_entrante";
                  return (
                    <li key={`${evento.at}-${indice}`} className="flex gap-3">
                      <div
                        className={`flex size-8 flex-shrink-0 items-center justify-center rounded-full ${
                          entrante ? "bg-accent/40 text-accent-foreground" : evento.tipo === "llamada_fallida" ? "bg-surface-muted text-muted-foreground" : "bg-surface-muted text-primary"
                        }`}
                      >
                        <Icono size={15} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">{evento.titulo}</p>
                        {evento.detalle && (
                          <p className={`mt-0.5 text-sm ${evento.tipo.startsWith("mensaje") ? "rounded-lg bg-surface-muted px-3 py-2 text-foreground" : "text-muted-foreground"}`}>
                            {evento.detalle}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {cuando.format(new Date(evento.at))}
                          {evento.quien ? ` · ${evento.quien}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Datos">
            <dl className="divide-y divide-border text-sm">
              {datos.map(([etiqueta, valor]) => (
                <div key={etiqueta} className="flex justify-between gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">{etiqueta}</dt>
                  <dd className="truncate text-right text-foreground">{valor ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard title="Registrar gestión" description="Queda en la historia de la ficha.">
            <ActionForm action={agregarNota} success="Gestión registrada" className="space-y-3 px-4 py-4">
              <input type="hidden" name="cuenta_id" value={id} />
              <Field label="Tipo">
                <Select name="tipo" defaultValue="llamada">
                  <option value="llamada">Llamada</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="correo">Correo</option>
                  <option value="reunion">{esVet ? "Consulta" : "Cita"}</option>
                  <option value="nota">Nota</option>
                </Select>
              </Field>
              <Field label="Qué pasó">
                <Input name="nota" required placeholder={esVet ? "Tutor confirma hora de vacuna" : "Paciente pide cuotas para el implante"} />
              </Field>
              <ActionSubmit size="sm">
                <CalendarClock size={14} aria-hidden="true" /> Registrar
              </ActionSubmit>
            </ActionForm>
          </SectionCard>

          <p className="px-1 text-xs text-muted-foreground">
            {esVet
              ? "La ficha clínica (anamnesis, exámenes, recetas) sigue en el software de la clínica. Atlas lleva la relación con el tutor."
              : "Las evoluciones, recetas e imágenes siguen en el software clínico. Atlas lleva el odontograma y la relación con el paciente."}
          </p>
        </div>
      </div>
    </div>
  );
}
