"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { esFechaValida, instanteEnChile } from "@/lib/citas";
import { NOMBRE_DIA } from "@/lib/configuracion-agenda";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

/*
 * El equipo de la agenda: profesionales (con su horario propio si difiere
 * del de la clínica), sillones o boxes, y bloqueos (vacaciones, feriados).
 * Lo hacen administración y supervisión; la seguridad por fila decide la
 * empresa.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = /^\d{2}:\d{2}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const COLORES = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#059669", "#dc2626", "#0891b2"];

function texto(formData: FormData, campo: string, largo = 120): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

async function contexto() {
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();
  const { data: empresa } = await supabase.rpc("current_org_id");
  if (typeof empresa !== "string") throw new Error("Elige una empresa antes de editar el equipo.");
  return { supabase, empresa };
}

function revalidar() {
  revalidatePath("/dashboard/citas/equipo");
  revalidatePath("/dashboard/citas");
  revalidatePath("/dashboard/citas/configuracion");
}

/** Lee el horario semanal de un formulario (mismos nombres que en la configuración). */
function horarioDelFormulario(formData: FormData): { dia_semana: number; desde: string; hasta: string }[] {
  const filas: { dia_semana: number; desde: string; hasta: string }[] = [];
  for (let dia = 1; dia <= 7; dia += 1) {
    if (formData.get(`d${dia}_abre`) !== "si") continue;
    const antes = filas.length;
    for (const tramo of [1, 2]) {
      const desde = String(formData.get(`d${dia}_desde${tramo}`) ?? "");
      const hasta = String(formData.get(`d${dia}_hasta${tramo}`) ?? "");
      if (!desde && !hasta) continue;
      if (!HORA.test(desde) || !HORA.test(hasta) || hasta <= desde) throw new Error(`Revisa las horas del ${NOMBRE_DIA[dia]}.`);
      filas.push({ dia_semana: dia, desde, hasta });
    }
    if (filas.length === antes) throw new Error(`Indica el horario del ${NOMBRE_DIA[dia]} o márcalo cerrado.`);
  }
  return filas;
}

export async function crearProfesional(formData: FormData) {
  const { supabase, empresa } = await contexto();
  const nombre = texto(formData, "nombre", 80);
  if (nombre.length < 3) throw new Error("Escribe el nombre como aparecerá en la agenda.");
  const { count } = await supabase.from("profesionales").select("id", { count: "exact", head: true }).eq("organization_id", empresa);
  const { error } = await supabase.from("profesionales").insert({
    organization_id: empresa,
    nombre,
    especialidad: texto(formData, "especialidad", 80) || null,
    color: COLORES[(count ?? 0) % COLORES.length],
    orden: (count ?? 0) + 1,
  });
  if (error) throw errorDeAccion(error, error.code === "23505" ? "Ya hay alguien con ese nombre en la agenda." : undefined);
  revalidar();
}

export async function guardarProfesional(formData: FormData) {
  const { supabase, empresa } = await contexto();
  const id = texto(formData, "id", 40);
  if (!UUID.test(id)) throw new Error("Profesional inválido.");
  const nombre = texto(formData, "nombre", 80);
  const color = texto(formData, "color", 7);
  if (nombre.length < 3) throw new Error("El nombre es muy corto.");
  if (!COLOR.test(color)) throw new Error("Color inválido.");
  const { error } = await supabase
    .from("profesionales")
    .update({ nombre, especialidad: texto(formData, "especialidad", 80) || null, color, activo: formData.get("activo") === "si" })
    .eq("id", id);
  if (error) throw errorDeAccion(error, error.code === "23505" ? "Ya hay alguien con ese nombre en la agenda." : undefined);

  // Horario propio: o el de la clínica (sin filas) o uno propio completo.
  const propio = formData.get("horario_propio") === "si";
  const filas = propio ? horarioDelFormulario(formData) : [];
  if (propio && filas.length === 0) throw new Error("Abre al menos un día o usa el horario de la clínica.");
  const { error: borrarError } = await supabase.from("horarios_atencion").delete().eq("profesional_id", id);
  if (borrarError) throw errorDeAccion(borrarError);
  if (filas.length) {
    const { error: horarioError } = await supabase
      .from("horarios_atencion")
      .insert(filas.map((fila) => ({ ...fila, organization_id: empresa, profesional_id: id })));
    if (horarioError) throw errorDeAccion(horarioError);
  }
  revalidar();
}

export async function crearRecurso(formData: FormData) {
  const { supabase, empresa } = await contexto();
  const nombre = texto(formData, "nombre", 40);
  if (nombre.length < 2) throw new Error("Escribe un nombre: «Sillón 1», «Box 2», «Pabellón».");
  const { count } = await supabase.from("recursos_agenda").select("id", { count: "exact", head: true }).eq("organization_id", empresa);
  const { error } = await supabase.from("recursos_agenda").insert({ organization_id: empresa, nombre, orden: (count ?? 0) + 1 });
  if (error) throw errorDeAccion(error, error.code === "23505" ? "Ya existe uno con ese nombre." : undefined);
  revalidar();
}

export async function cambiarRecurso(formData: FormData) {
  const { supabase } = await contexto();
  const id = texto(formData, "id", 40);
  if (!UUID.test(id)) throw new Error("Sillón o box inválido.");
  const { error } = await supabase.from("recursos_agenda").update({ activo: formData.get("activo") === "si" }).eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidar();
}

export async function crearBloqueo(formData: FormData) {
  const { supabase, empresa } = await contexto();
  const profesional = texto(formData, "profesional_id", 40);
  const desdeFecha = texto(formData, "desde_fecha", 10);
  const hastaFecha = texto(formData, "hasta_fecha", 10) || desdeFecha;
  const todoElDia = formData.get("todo_el_dia") === "si";
  const desdeHora = todoElDia ? "00:00" : texto(formData, "desde_hora", 5);
  const hastaHora = todoElDia ? "23:59" : texto(formData, "hasta_hora", 5);
  if (profesional && !UUID.test(profesional)) throw new Error("Elige a quién bloquear.");
  if (!esFechaValida(desdeFecha) || !esFechaValida(hastaFecha)) throw new Error("Revisa las fechas.");
  if (!HORA.test(desdeHora) || !HORA.test(hastaHora)) throw new Error("Revisa las horas.");
  const desde = instanteEnChile(desdeFecha, desdeHora);
  const hasta = instanteEnChile(hastaFecha, hastaHora);
  if (hasta <= desde) throw new Error("El término tiene que ser después del inicio.");
  if (hasta.getTime() - desde.getTime() > 120 * 24 * 60 * 60 * 1000) throw new Error("Un bloqueo puede durar como máximo 120 días.");
  const profile = await requireProfile(["admin", "supervisor"]);
  const { error } = await supabase.from("bloqueos_agenda").insert({
    organization_id: empresa,
    profesional_id: profesional || null,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    motivo: texto(formData, "motivo", 120) || null,
    creado_por: profile.id,
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}

export async function quitarBloqueo(formData: FormData) {
  const { supabase } = await contexto();
  const id = texto(formData, "id", 40);
  if (!UUID.test(id)) throw new Error("Bloqueo inválido.");
  const { error } = await supabase.from("bloqueos_agenda").delete().eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidar();
}
