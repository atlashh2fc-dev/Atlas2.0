import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { agendarCita, cambiarEstadoCita } from "@/app/actions/citas";
import { CreatePanel } from "@/components/create-panel";
import { Badge, EmptyState, Field, Input, PageHeader, SectionCard, Select, SubmitButton, buttonClasses } from "@/components/ui";
import {
  ETIQUETA_ESTADO,
  ZONA_CLINICA,
  esFechaValida,
  fechaEnChile,
  instanteEnChile,
  minutosEnChile,
  ocupaHorario,
  primero,
  sumarDias,
  type Cita,
  type Profesional,
} from "@/lib/citas";
import { PACIENTES_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * La agenda del día, por profesional.
 *
 * Es la pantalla que una recepción tiene abierta toda la jornada: quién viene
 * a qué hora y con quién, qué falta confirmar, quién está en sala. Desde una
 * cita se pasa a la ficha para registrar la atención; de ahí salen el cobro y
 * la próxima cita.
 */

const HORA_APERTURA = 8;
const HORA_CIERRE = 20;
const ALTO_MEDIA_HORA = 44;
const DURACIONES = [15, 20, 30, 45, 60, 90];

const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, weekday: "long", day: "numeric", month: "long" });
const hora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function Accion({
  cita,
  estado,
  label,
  dia,
  abrirFicha = false,
  variant = "secondary",
}: {
  cita: Cita;
  estado: Cita["estado"];
  label: string;
  dia: string;
  abrirFicha?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <form action={cambiarEstadoCita}>
      <input type="hidden" name="cita_id" value={cita.id} />
      <input type="hidden" name="cuenta_id" value={cita.cuenta_id} />
      <input type="hidden" name="estado" value={estado} />
      <input type="hidden" name="volver" value={`/dashboard/citas?dia=${dia}`} />
      {abrirFicha && <input type="hidden" name="abrir_ficha" value="si" />}
      <SubmitButton variant={variant} size="sm" pendingLabel="…">
        {label}
      </SubmitButton>
    </form>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const voc = PACIENTES_POR_EDICION[esVet ? "vet" : "dental"];
  const ahora = new Date();
  const hoy = fechaEnChile(ahora);
  const { dia: diaParam } = await searchParams;
  const dia = esFechaValida(diaParam) ? diaParam : hoy;
  const desde = instanteEnChile(dia, "00:00");
  const hasta = instanteEnChile(sumarDias(dia, 1), "00:00");

  const supabase = await createClient();
  const [{ data: profesionalesData }, { data: citasData, error }, { data: cuentas }, { data: mascotas }, { data: productos }] =
    await Promise.all([
      supabase.from("profesionales").select("id, nombre, especialidad, color, activo").eq("activo", true).order("orden").order("nombre"),
      supabase
        .from("citas")
        .select("id, cuenta_id, mascota_id, profesional_id, inicio, fin, motivo, estado, nota, sales_companies(name, phone), mascotas(nombre, especie)")
        .gte("inicio", desde.toISOString())
        .lt("inicio", hasta.toISOString())
        .order("inicio"),
      supabase.from("sales_companies").select("id, name").order("name").limit(800),
      esVet ? supabase.from("mascotas").select("id, nombre, cuenta_id").order("nombre").limit(1500) : Promise.resolve({ data: [] }),
      supabase.from("sales_products").select("name, duracion_min").eq("active", true).order("name").limit(300),
    ]);

  const profesionales = (profesionalesData ?? []) as Profesional[];
  const citas = (citasData ?? []) as unknown as Cita[];
  const nombreCuenta = new Map((cuentas ?? []).map((cuenta) => [cuenta.id as string, cuenta.name as string]));
  const activas = citas.filter((cita) => ocupaHorario(cita.estado));
  const sinConfirmar = activas.filter((cita) => cita.estado === "reservada").length;
  const enSala = activas.filter((cita) => cita.estado === "en_sala").length;
  const atendidas = activas.filter((cita) => cita.estado === "atendida").length;

  const filas = (HORA_CIERRE - HORA_APERTURA) * 2;
  const altoGrilla = filas * ALTO_MEDIA_HORA;
  const posicion = (instante: string) => ((minutosEnChile(new Date(instante)) - HORA_APERTURA * 60) / 30) * ALTO_MEDIA_HORA;
  const minutosAhora = minutosEnChile(ahora);
  const lineaAhora = dia === hoy && minutosAhora >= HORA_APERTURA * 60 && minutosAhora <= HORA_CIERRE * 60 ? ((minutosAhora - HORA_APERTURA * 60) / 30) * ALTO_MEDIA_HORA : null;

  const quien = (cita: Cita) => {
    const tutor = primero(cita.sales_companies)?.name ?? nombreCuenta.get(cita.cuenta_id) ?? "—";
    const mascota = primero(cita.mascotas);
    return mascota ? `${mascota.nombre} · ${tutor}` : tutor;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        description={`${capitalizar(fechaLarga.format(desde))} · ${activas.length} ${activas.length === 1 ? "cita" : "citas"}${sinConfirmar ? ` · ${sinConfirmar} sin confirmar` : ""}${enSala ? ` · ${enSala} en sala` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/citas?dia=${sumarDias(dia, -1)}`} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-label="Día anterior">
              <ChevronLeft size={16} aria-hidden="true" />
            </Link>
            <Link href="/dashboard/citas" className={buttonClasses({ variant: dia === hoy ? "primary" : "secondary", size: "sm" })}>
              Hoy
            </Link>
            <Link href={`/dashboard/citas?dia=${sumarDias(dia, 1)}`} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-label="Día siguiente">
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
            <form action="/dashboard/citas" className="flex items-center gap-2">
              <Input type="date" name="dia" defaultValue={dia} aria-label="Ir a una fecha" className="w-40" />
            </form>
            <CreatePanel
              label="Nueva cita"
              title="Nueva cita"
              description="Con la persona, el profesional y la hora basta. El horario tiene que estar libre."
              action={agendarCita}
              submitLabel="Agendar"
              successLabel="Cita agendada"
            >
              <Field label={voc.singular}>
                <Select name="cuenta_id" required defaultValue="" data-autofocus>
                  <option value="" disabled>
                    Elige {voc.singular.toLowerCase() === "tutor" ? "al tutor" : "al paciente"}
                  </option>
                  {(cuentas ?? []).map((cuenta) => (
                    <option key={cuenta.id as string} value={cuenta.id as string}>
                      {cuenta.name as string}
                    </option>
                  ))}
                </Select>
              </Field>
              {esVet && (
                <Field label="Mascota (opcional)">
                  <Select name="mascota_id" defaultValue="">
                    <option value="">Sin mascota</option>
                    {(mascotas ?? []).map((mascota) => (
                      <option key={mascota.id as string} value={mascota.id as string}>
                        {mascota.nombre as string} · {nombreCuenta.get(mascota.cuenta_id as string) ?? ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Profesional">
                <Select name="profesional_id" required defaultValue={profesionales[0]?.id ?? ""}>
                  {profesionales.map((profesional) => (
                    <option key={profesional.id} value={profesional.id}>
                      {profesional.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Fecha">
                  <Input type="date" name="fecha" required defaultValue={dia} />
                </Field>
                <Field label="Hora">
                  <Input type="time" name="hora" required defaultValue="09:00" step={300} />
                </Field>
                <Field label="Duración">
                  <Select name="duracion" defaultValue="30">
                    {DURACIONES.map((minutos) => (
                      <option key={minutos} value={minutos}>
                        {minutos} min
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Motivo">
                <Input name="motivo" required list="motivos-de-cita" placeholder={esVet ? "Control · vacuna · esterilización" : "Control · limpieza · restauración"} />
                <datalist id="motivos-de-cita">
                  {(productos ?? []).map((producto) => (
                    <option key={producto.name as string} value={producto.name as string} />
                  ))}
                </datalist>
              </Field>
              <Field label="Nota (opcional)">
                <Input name="nota" placeholder="Viene con dolor · traer exámenes" />
              </Field>
            </CreatePanel>
          </div>
        }
      />

      {error && <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">No se pudo leer la agenda. Vuelve a cargar para reintentar.</p>}

      {profesionales.length === 0 ? (
        <EmptyState title="Todavía no hay profesionales" description="La agenda se arma por profesional. Registra la primera atención y aparecerá acá, o pídenos que los carguemos." />
      ) : (
        <SectionCard title="Por profesional" description="Cada columna es una agenda. Lo cancelado y quien no vino quedan en gris y liberan la hora.">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid" style={{ gridTemplateColumns: `56px repeat(${profesionales.length}, minmax(180px, 1fr))` }}>
                <div />
                {profesionales.map((profesional) => (
                  <div key={profesional.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium text-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: profesional.color }} aria-hidden="true" />
                    {profesional.nombre}
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {activas.filter((cita) => cita.profesional_id === profesional.id).length}
                    </span>
                  </div>
                ))}
              </div>
              <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${profesionales.length}, minmax(180px, 1fr))`, height: altoGrilla }}>
                <div className="relative">
                  {Array.from({ length: filas }).map((_, fila) => (
                    <div key={fila} className="absolute right-2 text-[11px] tabular-nums text-muted-foreground" style={{ top: fila * ALTO_MEDIA_HORA - 7 }}>
                      {fila % 2 === 0 ? `${String(HORA_APERTURA + fila / 2).padStart(2, "0")}:00` : ""}
                    </div>
                  ))}
                </div>
                {profesionales.map((profesional) => (
                  <div key={profesional.id} className="relative border-l border-border">
                    {Array.from({ length: filas }).map((_, fila) => (
                      <div
                        key={fila}
                        className={`absolute inset-x-0 border-t ${fila % 2 === 0 ? "border-border" : "border-border/40"}`}
                        style={{ top: fila * ALTO_MEDIA_HORA }}
                        aria-hidden="true"
                      />
                    ))}
                    {citas
                      .filter((cita) => cita.profesional_id === profesional.id)
                      .map((cita) => {
                        const top = posicion(cita.inicio);
                        const alto = Math.max(ALTO_MEDIA_HORA * 0.9, posicion(cita.fin) - top);
                        const activa = ocupaHorario(cita.estado);
                        const etiqueta = ETIQUETA_ESTADO[cita.estado];
                        return (
                          <Link
                            key={cita.id}
                            href={`/dashboard/pacientes/${cita.cuenta_id}`}
                            title={`${hora.format(new Date(cita.inicio))} · ${quien(cita)} · ${cita.motivo} · ${etiqueta.label}`}
                            className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs leading-tight transition-shadow hover:shadow-md ${
                              activa ? "text-foreground" : "text-muted-foreground line-through opacity-60"
                            } ${cita.estado === "en_sala" ? "ring-2 ring-warning" : ""}`}
                            style={{ top: top + 2, height: alto - 4, borderLeftColor: profesional.color, backgroundColor: `${profesional.color}${activa ? "22" : "0d"}` }}
                          >
                            <span className="font-medium tabular-nums">{hora.format(new Date(cita.inicio))}</span> {quien(cita)}
                            <span className="block truncate text-muted-foreground">{cita.motivo}</span>
                          </Link>
                        );
                      })}
                  </div>
                ))}
                {lineaAhora !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: lineaAhora }} aria-hidden="true">
                    <span className="absolute -top-2 left-1 h-3 w-3 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Citas del día"
        description={`${atendidas} ${atendidas === 1 ? "atendida" : "atendidas"} de ${activas.length}. Confirmar, pasar a sala y dar por atendida se hace desde acá.`}
      >
        {citas.length === 0 ? (
          <EmptyState title="Sin citas este día" description='Agenda la primera con "Nueva cita".' />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Hora</th>
                  <th className="px-3 py-2 font-medium">{esVet ? "Mascota y tutor" : "Paciente"}</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 font-medium">Profesional</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {citas.map((cita) => {
                  const profesional = profesionales.find((candidato) => candidato.id === cita.profesional_id);
                  const etiqueta = ETIQUETA_ESTADO[cita.estado];
                  const telefono = primero(cita.sales_companies)?.phone;
                  const yaPaso = new Date(cita.inicio) <= ahora;
                  return (
                    <tr key={cita.id} className={ocupaHorario(cita.estado) ? "" : "text-muted-foreground"}>
                      <td className="px-4 py-2.5 tabular-nums">
                        {hora.format(new Date(cita.inicio))}
                        <span className="text-xs text-muted-foreground"> – {hora.format(new Date(cita.fin))}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/dashboard/pacientes/${cita.cuenta_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                          {quien(cita)}
                        </Link>
                        {telefono && <p className="text-xs text-muted-foreground">{telefono}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        {cita.motivo}
                        {cita.nota && <p className="text-xs text-muted-foreground">{cita.nota}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: profesional?.color }} aria-hidden="true" />
                          {profesional?.nombre ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {cita.estado === "reservada" && <Accion cita={cita} estado="confirmada" label="Confirmar" dia={dia} variant="primary" />}
                          {(cita.estado === "reservada" || cita.estado === "confirmada") && (
                            <Accion cita={cita} estado="en_sala" label="En sala" dia={dia} variant={cita.estado === "confirmada" ? "primary" : "secondary"} />
                          )}
                          {cita.estado === "en_sala" && <Accion cita={cita} estado="atendida" label="Atendida · registrar" dia={dia} abrirFicha variant="primary" />}
                          {(cita.estado === "reservada" || cita.estado === "confirmada") && yaPaso && (
                            <Accion cita={cita} estado="no_vino" label="No vino" dia={dia} variant="ghost" />
                          )}
                          {(cita.estado === "reservada" || cita.estado === "confirmada") && !yaPaso && (
                            <Accion cita={cita} estado="cancelada" label="Cancelar" dia={dia} variant="ghost" />
                          )}
                          {cita.estado === "atendida" && (
                            <Link href={`/dashboard/pacientes/${cita.cuenta_id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                              Ver ficha
                            </Link>
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
      {empresa && <p className="sr-only">{empresa}</p>}
    </div>
  );
}
