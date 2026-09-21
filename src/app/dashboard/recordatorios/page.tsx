import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Send } from "lucide-react";

import { cambiarEstadoCita } from "@/app/actions/citas";
import { cancelarMensaje, despacharAhora, enviarMensaje, reintentarMensaje } from "@/app/actions/mensajes";
import { Badge, Callout, EmptyState, PageHeader, SectionCard, SubmitButton, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile, primero, sumarDias, type Cita } from "@/lib/citas";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
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
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short" });
const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function primerNombre(nombre: string): string {
  return nombre.split(" ")[0] ?? nombre;
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
  return (
    <div className="flex items-center gap-2">
      {etiqueta && ultimo && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={ultimo.cuerpo ?? ""}>
          <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
          {ultimo.enviado_at ? fechaHora.format(new Date(ultimo.enviado_at)) : ""}
          {ultimo.proveedor === "simulado" && " · simulado"}
        </span>
      )}
      <form action={enviarMensaje} title={renderizarPlantilla(plantilla, variables)}>
        <input type="hidden" name="cuenta_id" value={cuenta} />
        <input type="hidden" name="plantilla" value={plantilla} />
        <input type="hidden" name="regla" value={regla} />
        <input type="hidden" name="origen_ref" value={origen} />
        <input type="hidden" name="variables" value={JSON.stringify(variables)} />
        <input type="hidden" name="canal" value={canal} />
        <SubmitButton size="sm" variant={yaSalio ? "ghost" : "secondary"} pendingLabel="Enviando…">
          <Send size={14} aria-hidden="true" /> {yaSalio ? "Reenviar" : canal === "correo" ? "Enviar correo" : "Enviar por Atlas"}
        </SubmitButton>
      </form>
    </div>
  );
}

export default async function RecordatoriosPage() {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const voc = PACIENTES_POR_EDICION[esVet ? "vet" : "dental"];
  const ventas = VENTAS_POR_EDICION[esVet ? "vet" : "dental"];
  const clinica = empresa ?? "la clínica";
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const manana = sumarDias(hoy, 1);
  const mesesSinVenir = esVet ? 12 : 6;
  const corteInactivos = sumarDias(hoy, -30 * mesesSinVenir);

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
    supabase.from("whatsapp_channels").select("status, display_phone_number").order("created_at").limit(1).maybeSingle(),
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recordatorios"
        description={`${total} ${total === 1 ? "contacto pendiente" : "contactos pendientes"}. Las reglas programan los mensajes solas cada día; acá ves si llegaron y puedes adelantar cualquiera.`}
        actions={
          <form action={despacharAhora}>
            <SubmitButton variant="secondary" pendingLabel="Enviando…">
              <Send size={16} aria-hidden="true" /> Enviar pendientes{programados ? ` (${programados})` : ""}
            </SubmitButton>
          </form>
        }
      />

      {!canalActivo && (
        <Callout tone="warning">
          <p className="font-medium">El WhatsApp de {clinica} todavía no está conectado</p>
          <p>
            Los mensajes salen igual por la cola y quedan marcados como simulados en la demostración. Cuando conectes el canal en
            Integraciones, saldrán de verdad por el número de la clínica y las respuestas caerán en Conversaciones.
          </p>
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Programados", valor: programados, detalle: "Salen en el próximo despacho" },
          { label: "Entregados", valor: entregados, detalle: "Últimos 14 días" },
          { label: "Respondieron", valor: respondidos, detalle: "Cayeron en Conversaciones", href: "/dashboard/mensajes" },
          { label: "Fallidos", valor: fallidos, detalle: "Revisa el número o el canal" },
        ].map((metrica: { label: string; valor: number; detalle: string; href?: string }) => (
          <div key={metrica.label} className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{metrica.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metrica.valor}</p>
            {metrica.href ? (
              <Link href={metrica.href} className="text-xs text-primary hover:underline">
                {metrica.detalle}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">{metrica.detalle}</p>
            )}
          </div>
        ))}
      </div>

      <SectionCard title={`Citas de mañana · ${citas.length}`} description="A las sin confirmar se les pide confirmación; a las confirmadas, se les recuerda. El mensaje sale solo en la mañana; puedes adelantarlo.">
        {citas.length === 0 ? (
          <EmptyState title="Sin citas mañana" description="No hay citas reservadas ni confirmadas para mañana." />
        ) : (
          <ul className="divide-y divide-border">
            {citas.map((cita) => {
              const tutor = primero(cita.sales_companies);
              const mascota = primero(cita.mascotas);
              const profesional = primero(cita.profesionales)?.nombre ?? "";
              const nombre = tutor?.name ?? "—";
              const plantilla: ClavePlantilla = cita.estado === "reservada" ? "cita_confirmar" : "cita_recordatorio";
              const variables = { nombre: primerNombre(nombre), hora: hora.format(new Date(cita.inicio)), profesional, motivo: cita.motivo, mascota: mascota?.nombre ?? "", clinica };
              return (
                <li key={cita.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-14 tabular-nums text-foreground">{hora.format(new Date(cita.inicio))}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${cita.cuenta_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {mascota ? `${mascota.nombre} · ${nombre}` : nombre}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {cita.motivo} · {profesional} · {cita.estado === "reservada" ? "sin confirmar" : "confirmada"}
                    </p>
                  </div>
                  <Enviar cuenta={cita.cuenta_id} plantilla={plantilla} regla="cita_manana" origen={cita.id} variables={variables} ultimo={ultimo("cita_manana", cita.id)} telefono={tutor?.phone} />
                  {cita.estado === "reservada" && (
                    <form action={cambiarEstadoCita}>
                      <input type="hidden" name="cita_id" value={cita.id} />
                      <input type="hidden" name="cuenta_id" value={cita.cuenta_id} />
                      <input type="hidden" name="estado" value="confirmada" />
                      <input type="hidden" name="volver" value="/dashboard/recordatorios" />
                      <SubmitButton size="sm" pendingLabel="…">Confirmada</SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {esVet && (
        <SectionCard title={`Vacunas vencidas o por vencer · ${vacunas.length}`} description="Las de los próximos 30 días y las que ya vencieron. Una vez al mes por mascota, o cuando lo adelantes.">
          {vacunas.length === 0 ? (
            <EmptyState title="Vacunas al día" description="Ninguna mascota tiene la vacuna vencida ni por vencer en 30 días." />
          ) : (
            <ul className="divide-y divide-border">
              {vacunas.map((mascota) => {
                const tutor = primero(mascota.sales_companies);
                const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
                const variables = { nombre: primerNombre(tutor?.name ?? ""), mascota: mascota.nombre, fecha: mascota.proxima_vacuna ? fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`)) : "", vencida: estado === "vencida", clinica };
                return (
                  <li key={mascota.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Badge tone={estado === "vencida" ? "danger" : "warning"}>{estado === "vencida" ? "Vencida" : "Por vencer"}</Badge>
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/pacientes/${tutor?.id ?? ""}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {mascota.nombre} · {tutor?.name ?? "—"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {mascota.especie} · vacuna {mascota.proxima_vacuna ? fecha.format(new Date(`${mascota.proxima_vacuna}T12:00:00`)) : "—"}
                      </p>
                    </div>
                    {tutor && <Enviar cuenta={tutor.id} plantilla="vacuna" regla="vacuna" origen={mascota.id} variables={variables} ultimo={ultimo("vacuna", mascota.id)} telefono={tutor.phone} />}
                    <Link href="/dashboard/citas" className={buttonClasses({ size: "sm" })}>
                      Agendar
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard title={`${ventas.negocios} sin respuesta hace más de 7 días · ${presupuestos.length}`} description={`${ventas.negocios} abiertos cuya próxima acción ya venció. Un mensaje a la semana hasta que respondan.`}>
        {presupuestos.length === 0 ? (
          <EmptyState title="Nada vencido" description={`Todos los ${ventas.negocios.toLowerCase()} abiertos tienen su próxima acción al día.`} />
        ) : (
          <ul className="divide-y divide-border">
            {presupuestos.map((presupuesto) => {
              const cuentaDe = primero(presupuesto.sales_companies);
              const variables = { nombre: primerNombre(cuentaDe?.name ?? ""), presupuesto: presupuesto.name, monto: pesos.format(Number(presupuesto.one_time_amount ?? 0)), clinica };
              return (
                <li key={presupuesto.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Badge tone="warning">{dias(presupuesto.next_action_at as string)} días</Badge>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/ventas/${presupuesto.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {presupuesto.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {cuentaDe?.name ?? "—"} · {pesos.format(Number(presupuesto.one_time_amount ?? 0))}
                    </p>
                  </div>
                  <Enviar cuenta={presupuesto.company_id} plantilla="presupuesto" regla="presupuesto" origen={presupuesto.id} variables={variables} ultimo={ultimo("presupuesto", presupuesto.id)} telefono={cuentaDe?.phone} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`${voc.titulo} que no vuelven hace más de ${mesesSinVenir} meses · ${inactivos.length}`} description={esVet ? "Un control anual es la visita que más se olvida y la que más recompra trae. Una vez al mes." : "El control semestral: la visita que mantiene la boca sana y la agenda llena. Una vez al mes."}>
        {inactivos.length === 0 ? (
          <EmptyState title="Nadie fuera de plazo" description="Todas las fichas con atenciones han vuelto dentro del plazo." />
        ) : (
          <ul className="divide-y divide-border">
            {inactivos.map((ficha) => {
              const variables = { nombre: primerNombre(ficha.name), meses: mesesSinVenir, clinica };
              return (
                <li key={ficha.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-24 text-xs text-muted-foreground">Última {ficha.ultima ? fecha.format(new Date(`${ficha.ultima}T12:00:00`)) : "—"}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/pacientes/${ficha.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {ficha.name}
                    </Link>
                  </div>
                  <Enviar cuenta={ficha.id} plantilla="control" regla="control" origen={ficha.id} variables={variables} ultimo={ultimo("control", ficha.id)} telefono={ficha.phone} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Lo que Atlas escribió" description="Los últimos 14 días, del más reciente al más antiguo. Lo fallido se puede reintentar; lo programado, cancelar.">
        {mensajes.length === 0 ? (
          <EmptyState title="Todavía no sale nada" description="Los mensajes aparecen acá en cuanto una regla los programa o alguien los envía." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Cuándo</th>
                  <th className="px-3 py-2 font-medium">Para</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 font-medium">Mensaje</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mensajes.slice(0, 80).map((mensaje) => {
                  const etiqueta = ETIQUETA_ESTADO_MENSAJE[mensaje.estado];
                  const cuerpo = mensaje.cuerpo ?? renderizarPlantilla(mensaje.plantilla, mensaje.variables ?? {});
                  return (
                    <tr key={mensaje.id} className="align-top">
                      <td className="px-4 py-2.5 text-muted-foreground">{fechaHora.format(new Date(mensaje.enviado_at ?? mensaje.programado_para))}</td>
                      <td className="px-3 py-2.5">
                        {mensaje.cuenta_id ? (
                          <Link href={`/dashboard/pacientes/${mensaje.cuenta_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                            {mensaje.nombre_destinatario ?? mensaje.destinatario}
                          </Link>
                        ) : (
                          mensaje.nombre_destinatario ?? mensaje.destinatario
                        )}
                        <p className="text-xs text-muted-foreground">{mensaje.destinatario}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {ETIQUETA_REGLA[mensaje.regla] ?? PLANTILLAS[mensaje.plantilla as ClavePlantilla]?.nombre ?? mensaje.regla}
                        <p className="text-xs">{mensaje.canal === "correo" ? "correo" : "WhatsApp"}</p>
                      </td>
                      <td className="max-w-md px-3 py-2.5 text-muted-foreground">
                        <p className="line-clamp-2" title={cuerpo}>
                          {cuerpo}
                        </p>
                        {mensaje.error && <p className="text-xs text-danger">{mensaje.error}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                        {mensaje.proveedor === "simulado" && <p className="text-xs text-muted-foreground">simulado</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {mensaje.estado === "fallido" && (
                            <form action={reintentarMensaje}>
                              <input type="hidden" name="mensaje_id" value={mensaje.id} />
                              <SubmitButton size="sm" variant="secondary" pendingLabel="…">Reintentar</SubmitButton>
                            </form>
                          )}
                          {(mensaje.estado === "programado" || mensaje.estado === "fallido") && (
                            <form action={cancelarMensaje}>
                              <input type="hidden" name="mensaje_id" value={mensaje.id} />
                              <SubmitButton size="sm" variant="ghost" pendingLabel="…">Cancelar</SubmitButton>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
