import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, CalendarOff, Plus, Users } from "lucide-react";

import { cambiarRecurso, crearBloqueo, crearProfesional, crearRecurso, guardarProfesional, quitarBloqueo } from "@/app/actions/equipo";
import { CopiarTexto, HorarioProfesional } from "@/components/agenda-config-cliente";
import { enlaceCalendario, enlaceGoogleCalendar } from "@/lib/calendario";
import { CreatePanel } from "@/components/create-panel";
import { ActionForm, ActionSubmit, Badge, EmptyState, Field, Input, PageHeader, SectionCard, Select, buttonClasses } from "@/components/ui";
import { ZONA_CLINICA, fechaEnChile } from "@/lib/citas";
import { HORARIO_POR_DEFECTO, resumenHorario, tramosPorDia, type TramoHorario } from "@/lib/configuracion-agenda";
import { ATENCION_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * El equipo de la agenda: quiénes atienden y cuándo, en qué sillones o
 * boxes, y cuándo no se atiende (vacaciones, feriados). Lo que se define
 * acá lo usan la agenda, la reserva en línea y los recordatorios.
 */

type Profesional = { id: string; nombre: string; especialidad: string | null; color: string; activo: boolean; perfil_id: string | null; comision_servicios: number; comision_productos: number; calendario_token: string | null };
type Recurso = { id: string; nombre: string; activo: boolean };
type Bloqueo = { id: string; profesional_id: string | null; desde: string; hasta: string; motivo: string | null };

const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default async function EquipoPage() {
  await connection();
  const { edicion } = await contextoDeMiEmpresa();
  const tipo = clinicaDe(edicion);
  const at = ATENCION_POR_EDICION[tipo];
  const nombreRecurso = tipo === "dental" ? { uno: "sillón", varios: "Sillones", ejemplo: "Sillón 1" } : tipo === "vet" ? { uno: "box", varios: "Boxes y salas", ejemplo: "Box 1" } : { uno: "silla", varios: "Sillas", ejemplo: "Silla 1" };
  const supabase = await createClient();
  const [{ data: profesionalesData }, { data: horariosData }, { data: recursosData }, { data: bloqueosData }, { data: usuariosData }] = await Promise.all([
    supabase.from("profesionales").select("id, nombre, especialidad, color, activo, perfil_id, comision_servicios, comision_productos, calendario_token").order("activo", { ascending: false }).order("orden").order("nombre"),
    supabase.from("horarios_atencion").select("profesional_id, dia_semana, desde, hasta").order("dia_semana").order("desde"),
    supabase.from("recursos_agenda").select("id, nombre, activo").order("orden").order("nombre"),
    supabase.from("bloqueos_agenda").select("id, profesional_id, desde, hasta, motivo").gte("hasta", new Date().toISOString()).order("desde").limit(100),
    supabase.from("profiles").select("id, full_name, email, role").eq("active", true).order("full_name"),
  ]);
  const usuarios = (usuariosData ?? []) as { id: string; full_name: string | null; email: string | null; role: string }[];
  const profesionales = (profesionalesData ?? []) as Profesional[];
  const horarios = (horariosData ?? []) as (TramoHorario & { profesional_id: string | null })[];
  const recursos = (recursosData ?? []) as Recurso[];
  const bloqueos = (bloqueosData ?? []) as Bloqueo[];
  const deLaClinica = horarios.filter((fila) => fila.profesional_id === null);
  const horarioClinica = tramosPorDia(deLaClinica.length ? deLaClinica : HORARIO_POR_DEFECTO);
  const nombreDe = new Map(profesionales.map((profesional) => [profesional.id, profesional.nombre]));
  const hoy = fechaEnChile(new Date());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Equipo y horarios"
        icon={Users}
        description={`Quiénes atienden y cuándo, ${nombreRecurso.varios.toLowerCase()}, y los días sin atención. La agenda y la reserva en línea usan esto.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/citas" className={buttonClasses({ variant: "ghost" })}>
              <ArrowLeft size={16} aria-hidden="true" /> Agenda
            </Link>
            <CreatePanel label={`Agregar ${at.profesional.toLowerCase()}`} title={`Nuevo ${at.profesional.toLowerCase()}`} description="Aparece de inmediato como columna en la agenda, con el horario de la clínica." action={crearProfesional} submitLabel="Agregar" successLabel="Agregado a la agenda">
              <Field label="Nombre como aparece en la agenda">
                <Input name="nombre" required minLength={3} placeholder={tipo === "barber" ? "Nico Rivas" : "Dra. Carolina Vidal"} data-autofocus />
              </Field>
              <Field label="Especialidad (opcional)">
                <Input name="especialidad" placeholder={tipo === "vet" ? "Medicina felina" : tipo === "barber" ? "Fades y diseño" : "Ortodoncia"} />
              </Field>
            </CreatePanel>
          </div>
        }
      />

      <SectionCard title={at.profesionales} description={`Horario de la clínica: ${resumenHorario(horarioClinica)}. Cámbialo en Configurar.`}>
        {profesionales.length === 0 ? (
          <EmptyState icon={Users} title={`Todavía no hay ${at.profesionales.toLowerCase()}`} description={`Agrega al primero con «Agregar ${at.profesional.toLowerCase()}»: la agenda se arma con una columna por persona.`} />
        ) : (
          <ul className="divide-y divide-border">
            {profesionales.map((profesional) => {
              const propios = horarios.filter((fila) => fila.profesional_id === profesional.id);
              const porDia = tramosPorDia(propios.length ? propios : deLaClinica.length ? deLaClinica : HORARIO_POR_DEFECTO);
              return (
                <li key={profesional.id} className="py-3 first:pt-0 last:pb-0">
                  <details className="group">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg">
                      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: profesional.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{profesional.nombre}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[profesional.especialidad, propios.length ? `Horario propio: ${resumenHorario(porDia)}` : "Horario de la clínica"].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {!profesional.activo && <Badge tone="neutral">Inactivo</Badge>}
                      <span className="text-sm text-primary group-open:hidden">Editar</span>
                      <span className="hidden text-sm text-muted-foreground group-open:inline">Cerrar</span>
                    </summary>
                    <ActionForm action={guardarProfesional} success="Cambios guardados" className="mt-4 space-y-4 rounded-lg border border-border p-4">
                      <input type="hidden" name="id" value={profesional.id} />
                      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
                        <Field label="Nombre">
                          <Input name="nombre" required minLength={3} defaultValue={profesional.nombre} />
                        </Field>
                        <Field label="Especialidad">
                          <Input name="especialidad" defaultValue={profesional.especialidad ?? ""} />
                        </Field>
                        <Field label="Color">
                          <input type="color" name="color" defaultValue={profesional.color} className="h-9 w-14 cursor-pointer rounded-lg border border-border-strong/70 bg-surface p-1" aria-label="Color en la agenda" />
                        </Field>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="Comisión por servicios (%)">
                          <Input name="comision_servicios" inputMode="decimal" defaultValue={String(Number(profesional.comision_servicios))} />
                        </Field>
                        <Field label="Comisión por productos (%)">
                          <Input name="comision_productos" inputMode="decimal" defaultValue={String(Number(profesional.comision_productos))} />
                        </Field>
                        <Field label="Su usuario en Atlas">
                          <Select name="perfil_id" defaultValue={profesional.perfil_id ?? ""}>
                            <option value="">Sin usuario</option>
                            {usuarios.map((usuario) => (
                              <option key={usuario.id} value={usuario.id}>{usuario.full_name || usuario.email}</option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <p className="-mt-2 text-xs text-muted-foreground">Con un usuario de rol Agente ligado, ve «Mi día»: sus citas, marca en sala o atendida y revisa su comisión del mes.</p>
                      {profesional.calendario_token && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted/50 px-3 py-2 text-sm">
                          <span className="text-muted-foreground">Su agenda en el celular:</span>
                          <a href={enlaceGoogleCalendar(profesional.calendario_token)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">Agregar a Google Calendar</a>
                          <span className="text-muted-foreground" aria-hidden="true">·</span>
                          <CopiarTexto texto={enlaceCalendario(profesional.calendario_token)} etiqueta="Copiar enlace (Apple, Outlook)" />
                        </div>
                      )}
                      <HorarioProfesional propio={propios.length > 0} inicial={porDia} deLaClinica={resumenHorario(horarioClinica)} puedeEditar />
                      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" name="activo" value="si" defaultChecked={profesional.activo} className="size-4" />
                        Atiende (si lo desmarcas, sale de la agenda y de la reserva en línea; sus citas pasadas se conservan)
                      </label>
                      <div className="flex justify-end">
                        <ActionSubmit variant="secondary" pendingLabel="Guardando…">Guardar</ActionSubmit>
                      </div>
                    </ActionForm>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title={nombreRecurso.varios} description={`Opcional. Si la cita usa un ${nombreRecurso.uno}, la agenda impide que dos citas lo ocupen a la vez.`}>
          <div className="space-y-4">
            {recursos.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {recursos.map((recurso) => (
                  <li key={recurso.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5">
                    <span className={recurso.activo ? "text-sm font-medium" : "text-sm text-muted-foreground line-through"}>{recurso.nombre}</span>
                    <ActionForm action={cambiarRecurso} success={recurso.activo ? "Quedó fuera de uso" : "Vuelve a estar disponible"}>
                      <input type="hidden" name="id" value={recurso.id} />
                      {!recurso.activo && <input type="hidden" name="activo" value="si" />}
                      <ActionSubmit size="sm" variant="ghost" pendingLabel="…">{recurso.activo ? "Dejar de usar" : "Volver a usar"}</ActionSubmit>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={crearRecurso} success="Agregado" className="flex items-end gap-2">
              <Field label={`Nuevo ${nombreRecurso.uno}`} className="flex-1">
                <Input name="nombre" required placeholder={nombreRecurso.ejemplo} />
              </Field>
              <ActionSubmit variant="secondary" pendingLabel="…"><Plus size={16} aria-hidden="true" /> Agregar</ActionSubmit>
            </ActionForm>
          </div>
        </SectionCard>

        <SectionCard title="Días sin atención" description="Vacaciones, cursos o feriados. Esas horas no se ofrecen en la reserva en línea y se ven bloqueadas en la agenda.">
          <div className="space-y-4">
            {bloqueos.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarOff size={16} aria-hidden="true" /> No hay bloqueos por delante.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {bloqueos.map((bloqueo) => (
                  <li key={bloqueo.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">{bloqueo.profesional_id ? nombreDe.get(bloqueo.profesional_id) ?? "—" : "Toda la clínica"}{bloqueo.motivo ? ` · ${bloqueo.motivo}` : ""}</span>
                      <span className="block text-xs text-muted-foreground">{fechaHora.format(new Date(bloqueo.desde))} → {fechaHora.format(new Date(bloqueo.hasta))}</span>
                    </span>
                    <ActionForm action={quitarBloqueo} success="Bloqueo quitado: esas horas vuelven a ofrecerse" confirm={{ title: "¿Quitar este bloqueo?", description: "Esas horas vuelven a quedar disponibles en la agenda y en la reserva en línea.", confirmLabel: "Quitar", tone: "danger" }}>
                      <input type="hidden" name="id" value={bloqueo.id} />
                      <ActionSubmit size="sm" variant="ghost" pendingLabel="…">Quitar</ActionSubmit>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            <details className="rounded-lg border border-border p-3">
              <summary className="min-h-9 cursor-pointer text-sm font-medium">Bloquear días u horas</summary>
              <ActionForm action={crearBloqueo} success="Bloqueado: esas horas ya no se ofrecen" className="mt-3 space-y-3">
                <Field label="¿Quién no atiende?">
                  <Select name="profesional_id" defaultValue="">
                    <option value="">Toda la clínica (feriado)</option>
                    {profesionales.filter((profesional) => profesional.activo).map((profesional) => <option key={profesional.id} value={profesional.id}>{profesional.nombre}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Desde"><Input type="date" name="desde_fecha" required defaultValue={hoy} min={hoy} /></Field>
                  <Field label="Hasta"><Input type="date" name="hasta_fecha" required defaultValue={hoy} min={hoy} /></Field>
                  <Field label="Hora inicio"><Input type="time" name="desde_hora" defaultValue="09:00" step={900} /></Field>
                  <Field label="Hora término"><Input type="time" name="hasta_hora" defaultValue="19:00" step={900} /></Field>
                </div>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" name="todo_el_dia" value="si" defaultChecked className="size-4" /> Días completos (ignora las horas)
                </label>
                <Field label="Motivo (opcional)"><Input name="motivo" placeholder="Vacaciones · Fiestas Patrias · Congreso" /></Field>
                <div className="flex justify-end"><ActionSubmit variant="secondary" pendingLabel="Guardando…">Bloquear</ActionSubmit></div>
              </ActionForm>
            </details>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
