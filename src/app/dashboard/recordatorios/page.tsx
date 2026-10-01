import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, BellRing, CalendarClock, CheckCheck, Clock, HandCoins, MessageSquareReply, MessagesSquare, Send, Syringe, UserRoundX } from "lucide-react";

import { cambiarEstadoCita } from "@/app/actions/citas";
import { cancelarMensaje, despacharAhora, enviarMensaje, reintentarMensaje } from "@/app/actions/mensajes";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, PageHeader, SectionCard, Table, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { requireProfile } from "@/lib/auth";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile, primero, sumarDias, type Cita } from "@/lib/citas";
import { ATENCION_POR_EDICION, PACIENTES_POR_EDICION, VENTAS_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { estadoVacuna } from "@/lib/mascotas";
import { ETIQUETA_ESTADO_MENSAJE, ETIQUETA_REGLA, PLANTILLAS, renderizarPlantilla, type ClavePlantilla, type EstadoMensaje } from "@/lib/mensajes/plantillas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Recordatorios: a quién le escribe Atlas hoy, y qué pasó con lo que escribió.
 *
 * No es un embudo ni una lista para llamar: es la cola de mensajes de la
 * clínica. Las reglas (cita de mañana, vacuna, presupuesto sin respuesta,
 * control pendiente) programan los mensajes solas cada día; acá se ve lo
 * que salió, si llegó y si respondieron, y se puede adelantar cualquiera
 * con un clic. Todo sale por el WhatsApp de la clínica, desde Atlas.
 */

const DIA = 24 * 60 * 60 * 1000;
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });
const soloDia = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });
const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Título de sección con su conteo en caja suave. */
function Titulo({ texto, total }: { texto: string; total: number }) {
  return (
    <span className="flex items-center gap-2">
      {texto}
      <span className="rounded-md bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">{total}</span>
    </span>
  );
}

function primerNombre(nombre: string): string {
  return nombre.split(" ")[0] ?? nombre;
}

/**
 * El despacho guarda el motivo del fallo tal como lo devolvió el proveedor o
 * la base. En pantalla va una frase con el siguiente paso; el original queda
 * en el title para soporte.
 */
function errorLegible(error: string, canal: string, esAdmin: boolean): string {
  const nombreCanal = canal === "correo" ? "correo" : "WhatsApp";
  if (/integraciones|no est[aá] conectado|no tiene un canal|puente|no hay por d[oó]nde/i.test(error)) {
    return `El ${nombreCanal} de la clínica no está conectado. ${esAdmin ? "Conéctalo en Integraciones y reintenta." : "Pídele a un administrador que lo conecte y luego reintenta."}`;
  }
  if (/ficha de destino/i.test(error)) return "El mensaje quedó sin ficha de destino. Cancélalo y envíalo de nuevo desde la ficha.";
  return `No se pudo entregar. Revisa el ${canal === "correo" ? "correo" : "celular"} de la ficha y usa «Reintentar».`;
}

type Mensaje = {
  id: string;
  cuenta_id: string | null;
  nombre_destinatario: string | null;
  destinatario: string;
  canal: string;
  regla: string;
  origen_ref: string | null;
  plantilla: string;
  variables: Record<string, unknown>;
  cuerpo: string | null;
  estado: EstadoMensaje;
  proveedor: string | null;
  error: string | null;
  programado_para: string;
  enviado_at: string | null;
  created_at: string;
};

type Vacuna = { id: string; nombre: string; especie: string; proxima_vacuna: string | null; sales_companies: { id: string; name: string; phone: string | null } | { id: string; name: string; phone: string | null }[] | null };
type Presupuesto = { id: string; name: string; next_action_at: string | null; one_time_amount: number | null; company_id: string; sales_companies: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null };
type Cuenta = { id: string; name: string; phone: string | null; atenciones: { fecha: string }[] | null };

/** El botón "Enviar por Atlas": programa el mensaje y lo despacha al tiro. */
function Enviar({
  cuenta,
  plantilla,
  regla,
  origen,
  variables,
  ultimo,
  telefono,
}: {
  cuenta: string;
  plantilla: ClavePlantilla;
  regla: string;
  origen: string;
  variables: Record<string, unknown>;
  ultimo?: Mensaje;
  /** Sin celular, el mensaje sale por correo. */
  telefono?: string | null;
}) {
  const canal = telefono && telefono.trim() ? "whatsapp" : "correo";
  const etiqueta = ultimo ? ETIQUETA_ESTADO_MENSAJE[ultimo.estado] : null;
  const yaSalio = ultimo && !["fallido", "cancelado"].includes(ultimo.estado);
  // Lo que va a recibir la persona, a la vista antes de enviarlo: si ya salió,
  // el texto real; si no, la plantilla con sus datos.
  const texto = (yaSalio ? ultimo?.cuerpo : null) ?? renderizarPlantilla(plantilla, variables);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-80">
      <div className="flex items-center justify-end gap-2">
        {etiqueta && ultimo && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
            {ultimo.enviado_at ? fechaHora.format(new Date(ultimo.enviado_at)) : ""}
            {ultimo.proveedor === "simulado" && " · simulado"}
          </span>
        )}
        <ActionForm action={enviarMensaje} success={canal === "correo" ? "Correo enviado" : "WhatsApp enviado"}>
          <input type="hidden" name="cuenta_id" value={cuenta} />
          <input type="hidden" name="plantilla" value={plantilla} />
          <input type="hidden" name="regla" value={regla} />
          <input type="hidden" name="origen_ref" value={origen} />
          <input type="hidden" name="variables" value={JSON.stringify(variables)} />
          <input type="hidden" name="canal" value={canal} />
          <ActionSubmit size="sm" variant={yaSalio ? "ghost" : "secondary"} pendingLabel="Enviando…">
            <Send size={14} aria-hidden="true" /> {yaSalio ? "Reenviar" : canal === "correo" ? "Enviar correo" : "Enviar por Atlas"}
          </ActionSubmit>
        </ActionForm>
      </div>
      <details className="group text-xs text-muted-foreground">
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1 rounded hover:text-foreground">
          <span className="truncate group-open:hidden">«{texto}»</span>
          <span className="hidden shrink-0 group-open:inline">Ocultar mensaje</span>
          <span className="shrink-0 text-primary group-open:hidden">Ver completo</span>
        </summary>
        <p className="mt-1 whitespace-pre-line rounded-lg bg-surface-muted/60 px-3 py-2 text-foreground">{texto}</p>
      </details>
    </div>
  );
}

export default async function RecordatoriosPage() {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const esAdmin = profile.role === "admin";
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const tipo = clinicaDe(edicion);
  const esVet = tipo === "vet";
  const voc = PACIENTES_POR_EDICION[tipo];
  const ventas = VENTAS_POR_EDICION[tipo];
  const at = ATENCION_POR_EDICION[tipo];
  const clinica = empresa ?? "la clínica";
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const manana = sumarDias(hoy, 1);
  const corteInactivos = sumarDias(hoy, -at.diasSinVenir);
  const reglaVuelta = at.plantillaVuelta;

  const supabase = await createClient();
  const [{ data: citasData }, { data: vacunasData }, { data: presupuestosData }, { data: cuentasData }, { data: mensajesData }, { data: canal }] = await Promise.all([
    supabase
      .from("citas")
      .select("id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, estado, nota, sales_companies(name, phone), mascotas(nombre, especie), profesionales(nombre)")
      .in("estado", ["reservada", "confirmada"])
      .gte("inicio", instanteEnChile(manana, "00:00").toISOString())
      .lt("inicio", instanteEnChile(sumarDias(manana, 1), "00:00").toISOString())
      .order("inicio"),
    esVet
      ? supabase
          .from("mascotas")
          .select("id, nombre, especie, proxima_vacuna, sales_companies(id, name, phone)")
          .not("proxima_vacuna", "is", null)
          .lte("proxima_vacuna", sumarDias(hoy, 30))
          .order("proxima_vacuna")
          .limit(150)
      : Promise.resolve({ data: [] }),
    supabase
      .from("sales_opportunities")
      .select("id, name, next_action_at, one_time_amount, company_id, sales_companies(name, phone)")
      .eq("status", "abierta")
      .not("next_action_at", "is", null)
      .lte("next_action_at", new Date(ahora.getTime() - 7 * DIA).toISOString())
      .order("next_action_at")
      .limit(150),
    supabase
      .from("sales_companies")
      .select("id, name, phone, atenciones(fecha)")
      .order("fecha", { referencedTable: "atenciones", ascending: false })
      .limit(1, { referencedTable: "atenciones" })
      .order("name")
      .limit(600),
    supabase
      .from("mensajes_salientes")
      .select("id, cuenta_id, nombre_destinatario, destinatario, canal, regla, origen_ref, plantilla, variables, cuerpo, estado, proveedor, error, programado_para, enviado_at, created_at")
      .gte("created_at", new Date(ahora.getTime() - 14 * DIA).toISOString())
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("whatsapp_channels").select("status, display_phone_number").eq("canal", "whatsapp").order("created_at").limit(1).maybeSingle(),
  ]);

  const citas = (citasData ?? []) as unknown as (Cita & { profesionales: { nombre: string } | { nombre: string }[] | null })[];
  const vacunas = ((vacunasData ?? []) as unknown as Vacuna[]).filter((mascota) => {
    const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
    return estado === "vencida" || estado === "por_vencer";
  });
  const presupuestos = (presupuestosData ?? []) as unknown as Presupuesto[];
  const inactivos = ((cuentasData ?? []) as unknown as Cuenta[])
    .map((cuenta) => ({ ...cuenta, ultima: cuenta.atenciones?.[0]?.fecha ?? null }))
    .filter((cuenta) => cuenta.ultima !== null && cuenta.ultima < corteInactivos)
    .sort((a, b) => (a.ultima ?? "").localeCompare(b.ultima ?? ""))
    .slice(0, 40);
  const mensajes = (mensajesData ?? []) as unknown as Mensaje[];

  // El último mensaje por lo que lo motivó: la cita, la mascota, el presupuesto o la ficha.
  const ultimoPor = new Map<string, Mensaje>();
  for (const mensaje of mensajes) {
    const clave = `${mensaje.regla}:${mensaje.origen_ref ?? ""}`;
    if (!ultimoPor.has(clave)) ultimoPor.set(clave, mensaje);
  }
  const ultimo = (regla: string, origen: string) => ultimoPor.get(`${regla}:${origen}`);

  const cuenta = (estado: EstadoMensaje) => mensajes.filter((mensaje) => mensaje.estado === estado).length;
  const programados = cuenta("programado") + cuenta("enviando");
  const entregados = cuenta("entregado") + cuenta("leido") + cuenta("respondido");
  const fallidos = cuenta("fallido");
  const respondidos = cuenta("respondido");
  const total = citas.length + vacunas.length + presupuestos.length + inactivos.length;
  const dias = (desde: string) => Math.floor((ahora.getTime() - new Date(desde).getTime()) / DIA);
  const canalActivo = canal?.status === "active";
  const pendientesWhatsapp = mensajes.filter((mensaje) => mensaje.estado === "programado" && mensaje.canal !== "correo").length;
  const pendientesCorreo = mensajes.filter((mensaje) => mensaje.estado === "programado" && mensaje.canal === "correo").length;
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recordatorios"
        icon={BellRing}
        description="Las reglas programan los mensajes solas cada día; acá ves si llegaron y puedes adelantar cualquiera."
        meta={
          <span>
            <span className="font-medium text-foreground">{total}</span> {total === 1 ? "contacto pendiente" : "contactos pendientes"}
          </span>
        }
        actions={
          <ActionForm
            action={despacharAhora}
            success="Despacho hecho: revisa el estado en «Lo que Atlas escribió»"
            confirm={{
              title: "¿Enviar ahora los mensajes pendientes?",
              description: (
                <>
                  <p>
                    Salen ahora {plural(pendientesWhatsapp, "WhatsApp", "WhatsApp")} y {plural(pendientesCorreo, "correo", "correos")} programados
                    {canalActivo ? ` por el número de ${clinica}` : " (simulados: el WhatsApp de la clínica no está conectado)"}, más los que las reglas
                    generen hoy.
                  </p>
                  <p className="mt-2">Lo que sale ya no se puede retirar.</p>
                </>
              ),
              confirmLabel: pendientesWhatsapp + pendientesCorreo > 0 ? `Enviar ${pendientesWhatsapp + pendientesCorreo} ahora` : "Enviar ahora",
              tone: "primary",
            }}
          >
            <ActionSubmit variant="secondary" pendingLabel="Enviando…">
              <Send size={16} aria-hidden="true" /> Enviar pendientes{programados ? ` (${programados})` : ""}
            </ActionSubmit>
          </ActionForm>
        }
      />

      {!canalActivo && (
        <Callout tone="warning">
          <p className="font-medium">El WhatsApp de {clinica} todavía no está conectado</p>
          <p>
            Los mensajes salen igual por la cola y quedan marcados como simulados en la demostración. Cuando el canal esté conectado, saldrán de
            verdad por el número de la clínica y las respuestas caerán en Conversaciones.{" "}
            {esAdmin ? (
              <Link href="/dashboard/admin/integraciones/whatsapp" className="font-medium text-primary hover:underline">
                Conectar el WhatsApp
              </Link>
            ) : (
              "Para conectarlo, pídeselo a un administrador."
            )}
          </p>
        </Callout>
      )}

      <KpiStrip columns={4} title="Mensajes" meta="Últimos 14 días">
        <KpiStripItem label="Programados" value={String(programados)} icon={Clock} detail="Salen en el próximo despacho" />
        <KpiStripItem label="Entregados" value={String(entregados)} icon={CheckCheck} tone={entregados > 0 ? "good" : "default"} detail="Llegaron al destinatario" />
        <KpiStripItem label="Respondieron" value={String(respondidos)} icon={MessageSquareReply} href="/dashboard/mensajes" detail="Cayeron en Conversaciones" />
        <KpiStripItem label="Fallidos" value={String(fallidos)} icon={AlertTriangle} tone={fallidos > 0 ? "danger" : "default"} detail="Revisa el número o el canal" />
      </KpiStrip>

      <SectionCard title={<Titulo texto="Citas de mañana" total={citas.length} />} description="A las sin confirmar se les pide confirmación; a las confirmadas, se les recuerda. El mensaje sale solo en la mañana; puedes adelantarlo.">
        {citas.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Sin citas mañana" description="No hay citas reservadas ni confirmadas para mañana." />
        ) : (
          <ul className="divide-y divide-border/70 border-t border-border">
            {citas.map((cita) => {
              const tutor = primero(cita.sales_companies);
              const mascota = primero(cita.mascotas);
              const profesional = primero(cita.profesionales)?.nombre ?? "";
              const nombre = tutor?.name ?? "—";
              const plantilla: ClavePlantilla = cita.estado === "reservada" ? "cita_confirmar" : "cita_recordatorio";
              const variables = { nombre: primerNombre(nombre), hora: hora.format(new Date(cita.inicio)), profesional, motivo: cita.motivo, mascota: mascota?.nombre ?? "", clinica };
              return (
                <li key={cita.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="w-12 text-[13px] font-semibold tabular-nums text-foreground">{hora.format(new Date(cita.inicio))}</span>
                  <Avatar name={nombre} size="md" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${cita.cuenta_id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                      {mascota ? `${mascota.nombre} · ${nombre}` : nombre}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{cita.motivo} · {profesional}</span>
                      <Badge tone={cita.estado === "reservada" ? "neutral" : "info"} dot className="text-xs">
                        {cita.estado === "reservada" ? "Sin confirmar" : "Confirmada"}
                      </Badge>
                    </p>
                  </div>
                  <Enviar cuenta={cita.cuenta_id} plantilla={plantilla} regla="cita_manana" origen={cita.id} variables={variables} ultimo={ultimo("cita_manana", cita.id)} telefono={tutor?.phone} />
                  {cita.estado === "reservada" && (
                    <ActionForm action={cambiarEstadoCita} success="Cita confirmada">
                      <input type="hidden" name="cita_id" value={cita.id} />
                      <input type="hidden" name="cuenta_id" value={cita.cuenta_id} />
                      <input type="hidden" name="estado" value="confirmada" />
                      <input type="hidden" name="volver" value="/dashboard/recordatorios" />
                      <ActionSubmit size="sm" variant="secondary" pendingLabel="…">Confirmada</ActionSubmit>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {esVet && (
        <SectionCard title={<Titulo texto="Vacunas vencidas o por vencer" total={vacunas.length} />} description="Las de los próximos 30 días y las que ya vencieron. Una vez al mes por mascota, o cuando lo adelantes.">
          {vacunas.length === 0 ? (
            <EmptyState icon={Syringe} title="Vacunas al día" description="Ninguna mascota tiene la vacuna vencida ni por vencer en 30 días." />
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border">
              {vacunas.map((mascota) => {
                const tutor = primero(mascota.sales_companies);
                const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
                const variables = { nombre: primerNombre(tutor?.name ?? ""), mascota: mascota.nombre, fecha: mascota.proxima_vacuna ? fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`)) : "", vencida: estado === "vencida", clinica };
                return (
                  <li key={mascota.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="icon-chip size-9 rounded-lg" data-tone={estado === "vencida" ? "rose" : "amber"} aria-hidden="true">
                      <Syringe size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/pacientes/${tutor?.id ?? ""}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                        {mascota.nombre} · {tutor?.name ?? "—"}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{mascota.especie} · vacuna {mascota.proxima_vacuna ? fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`)).replace(".", "") : "—"}</span>
                        <Badge tone={estado === "vencida" ? "danger" : "warning"} className="text-xs">{estado === "vencida" ? "Vencida" : "Por vencer"}</Badge>
                      </p>
                    </div>
                    {tutor && <Enviar cuenta={tutor.id} plantilla="vacuna" regla="vacuna" origen={mascota.id} variables={variables} ultimo={ultimo("vacuna", mascota.id)} telefono={tutor.phone} />}
                    <Link href={tutor ? `/dashboard/citas?cuenta=${tutor.id}&mascota=${mascota.id}` : "/dashboard/citas"} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      Agendar
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard title={<Titulo texto={`${ventas.negocios} sin respuesta hace más de 7 días`} total={presupuestos.length} />} description={`${ventas.negocios} abiertos cuya próxima acción ya venció. Un mensaje a la semana hasta que respondan.`}>
        {presupuestos.length === 0 ? (
          <EmptyState icon={HandCoins} title="Nada vencido" description={`Todos los ${ventas.negocios.toLowerCase()} abiertos tienen su próxima acción al día.`} />
        ) : (
          <ul className="divide-y divide-border/70 border-t border-border">
            {presupuestos.map((presupuesto) => {
              const cuentaDe = primero(presupuesto.sales_companies);
              const variables = { nombre: primerNombre(cuentaDe?.name ?? ""), presupuesto: presupuesto.name, monto: pesos.format(Number(presupuesto.one_time_amount ?? 0)), clinica };
              return (
                <li key={presupuesto.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={cuentaDe?.name ?? "—"} size="md" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/ventas/${presupuesto.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                      {presupuesto.name}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{cuentaDe?.name ?? "—"} · {pesos.format(Number(presupuesto.one_time_amount ?? 0))}</span>
                      <Badge tone="warning" className="text-xs">{dias(presupuesto.next_action_at as string)} días sin respuesta</Badge>
                    </p>
                  </div>
                  <Enviar cuenta={presupuesto.company_id} plantilla="presupuesto" regla="presupuesto" origen={presupuesto.id} variables={variables} ultimo={ultimo("presupuesto", presupuesto.id)} telefono={cuentaDe?.phone} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={<Titulo texto={`${voc.titulo} que no vuelven hace más de ${at.plazoSinVenir}`} total={inactivos.length} />} description={at.porQueVolver}>
        {inactivos.length === 0 ? (
          <EmptyState icon={UserRoundX} title="Nadie fuera de plazo" description="Todas las fichas con atenciones han vuelto dentro del plazo." />
        ) : (
          <ul className="divide-y divide-border/70 border-t border-border">
            {inactivos.map((ficha) => {
              const semanas = ficha.ultima ? Math.max(1, Math.floor((ahora.getTime() - new Date(`${ficha.ultima}T12:00:00`).getTime()) / (7 * DIA))) : null;
              const variables = { nombre: primerNombre(ficha.name), meses: Math.round(at.diasSinVenir / 30), semanas, clinica };
              return (
                <li key={ficha.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={ficha.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${ficha.id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                      {ficha.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Última atención {ficha.ultima ? fecha.format(new Date(`${ficha.ultima}T12:00:00`)).replace(".", "") : "—"}
                    </p>
                  </div>
                  <Enviar cuenta={ficha.id} plantilla={reglaVuelta} regla={reglaVuelta} origen={ficha.id} variables={variables} ultimo={ultimo(reglaVuelta, ficha.id)} telefono={ficha.phone} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Lo que Atlas escribió" description="Los últimos 14 días, del más reciente al más antiguo. Lo fallido se puede reintentar; lo programado, cancelar.">
        {mensajes.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="Todavía no sale nada" description="Los mensajes aparecen acá en cuanto una regla los programa o alguien los envía." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Cuándo</Th>
                <Th>Para</Th>
                <Th>Motivo</Th>
                <Th>Mensaje</Th>
                <Th>Estado</Th>
                <Th align="right">
                  <span className="sr-only">Acciones</span>
                </Th>
              </Thead>
              <Tbody>
                {mensajes.slice(0, 80).map((mensaje) => {
                  const etiqueta = ETIQUETA_ESTADO_MENSAJE[mensaje.estado];
                  const cuerpo = mensaje.cuerpo ?? renderizarPlantilla(mensaje.plantilla, mensaje.variables ?? {});
                  const instante = new Date(mensaje.enviado_at ?? mensaje.programado_para);
                  const destinatario = mensaje.nombre_destinatario ?? mensaje.destinatario;
                  return (
                    <Tr key={mensaje.id} className="align-top">
                      <Td className="whitespace-nowrap">
                        <span className="block text-foreground">{soloDia.format(instante).replace(".", "")}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{hora.format(instante)}</span>
                      </Td>
                      <Td>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={destinatario} size="sm" />
                          <span className="min-w-0">
                            {mensaje.cuenta_id ? (
                              <Link href={`/dashboard/pacientes/${mensaje.cuenta_id}`} className="block truncate font-medium text-foreground hover:text-primary hover:underline">
                                {destinatario}
                              </Link>
                            ) : (
                              <span className="block truncate font-medium text-foreground">{destinatario}</span>
                            )}
                            <span className="block text-xs text-muted-foreground">{mensaje.destinatario}</span>
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-foreground">
                          {ETIQUETA_REGLA[mensaje.regla] ?? PLANTILLAS[mensaje.plantilla as ClavePlantilla]?.nombre ?? mensaje.regla}
                        </span>
                        <span className="block text-xs text-muted-foreground">{mensaje.canal === "correo" ? "Correo" : "WhatsApp"}</span>
                      </Td>
                      <Td className="max-w-md">
                        <p className="line-clamp-2 text-muted-foreground" title={cuerpo}>
                          {cuerpo}
                        </p>
                        {mensaje.error && (
                          <p className="mt-0.5 text-xs text-danger" title={mensaje.error}>
                            {errorLegible(mensaje.error, mensaje.canal, esAdmin)}
                          </p>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                        {mensaje.proveedor === "simulado" && <span className="mt-0.5 block text-xs text-muted-foreground">Simulado</span>}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          {mensaje.estado === "fallido" && (
                            <ActionForm action={reintentarMensaje} success="Mensaje reintentado">
                              <input type="hidden" name="mensaje_id" value={mensaje.id} />
                              <ActionSubmit size="sm" variant="secondary" pendingLabel="…">Reintentar</ActionSubmit>
                            </ActionForm>
                          )}
                          {(mensaje.estado === "programado" || mensaje.estado === "fallido") && (
                            <ActionForm action={cancelarMensaje} success="Mensaje cancelado">
                              <input type="hidden" name="mensaje_id" value={mensaje.id} />
                              <ActionSubmit size="sm" variant="ghost" pendingLabel="…">Cancelar envío</ActionSubmit>
                            </ActionForm>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
