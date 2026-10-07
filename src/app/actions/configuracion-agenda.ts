"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { configuracionDesdeFila, HORAS_DE_ENVIO, NOMBRE_DIA } from "@/lib/configuracion-agenda";
import { normalizarSlug, SLUG_VALIDO, SLUGS_RESERVADOS } from "@/lib/reserva";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { PLANTILLAS_EDITABLES, validarTextoPropio, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { createClient } from "@/lib/supabase/server";

/*
 * La configuración de la agenda. Solo un administrador la cambia; la fila es
 * de su empresa (la seguridad por fila lo impone) y se crea la primera vez.
 */

async function empresaYTextos() {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: organizacion } = await supabase.rpc("current_org_id");
  if (typeof organizacion !== "string") throw new Error("No sabemos de qué empresa es la agenda. Vuelve a entrar.");
  const { data, error } = await supabase.from("configuracion_agenda").select("*").eq("organization_id", organizacion).maybeSingle();
  if (error) throw errorDeAccion(error);
  return { supabase, organizacion, profile, actual: configuracionDesdeFila(data) };
}

function revalidar() {
  revalidatePath("/dashboard/citas/configuracion");
  revalidatePath("/dashboard/recordatorios");
  revalidatePath("/dashboard/citas");
}

export async function guardarRecordatorios(formData: FormData) {
  const { supabase, organizacion, profile, actual } = await empresaYTextos();
  const dias = Number(formData.get("recordatorio_dias_antes"));
  const desde = String(formData.get("recordatorio_desde") ?? "");
  if (!Number.isInteger(dias) || dias < 0 || dias > 3) throw new Error("Elige con cuánta anticipación sale el recordatorio.");
  if (!HORAS_DE_ENVIO.includes(desde)) throw new Error("Elige desde qué hora sale.");
  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    recordatorio_dias_antes: dias,
    recordatorio_desde: desde,
    confirmacion_automatica: formData.get("confirmacion_automatica") === "si",
    textos: actual.textos,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}

export async function guardarTextoPropio(formData: FormData) {
  const { supabase, organizacion, profile, actual } = await empresaYTextos();
  const clave = String(formData.get("plantilla") ?? "") as ClavePlantilla;
  if (!(clave in PLANTILLAS_EDITABLES)) throw new Error("Ese mensaje no se puede editar.");
  const texto = String(formData.get("texto") ?? "").trim();
  const restaurar = formData.get("restaurar") === "si";
  if (!restaurar) {
    const problema = validarTextoPropio(clave, texto);
    if (problema) throw new Error(problema);
  }
  const textos = { ...actual.textos };
  if (restaurar) delete textos[clave];
  else textos[clave] = texto;
  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    recordatorio_dias_antes: actual.recordatorio_dias_antes,
    recordatorio_desde: actual.recordatorio_desde,
    confirmacion_automatica: actual.confirmacion_automatica,
    textos,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = /^\d{2}:\d{2}$/;

/** Activar o pausar la reserva en línea, con su enlace y sus reglas. */
export async function guardarReservaEnLinea(formData: FormData) {
  const { supabase, organizacion, profile } = await empresaYTextos();
  const activa = formData.get("reserva_activa") === "si";
  const slug = normalizarSlug(String(formData.get("reserva_slug") ?? ""));
  const anticipacion = Number(formData.get("reserva_anticipacion_horas"));
  const dias = Number(formData.get("reserva_dias"));
  const intervalo = Number(formData.get("reserva_intervalo_min"));
  const mensaje = String(formData.get("reserva_mensaje") ?? "").trim().slice(0, 400);
  if (!SLUG_VALIDO.test(slug) || SLUGS_RESERVADOS.has(slug)) throw new Error("El enlace necesita entre 3 y 40 letras, números o guiones.");
  if (![0, 1, 2, 4, 12, 24, 48].includes(anticipacion)) throw new Error("Elige con cuánta anticipación se puede reservar.");
  if (![7, 14, 30, 60, 90].includes(dias)) throw new Error("Elige hasta cuándo se puede reservar.");
  if (![10, 15, 20, 30, 60].includes(intervalo)) throw new Error("Elige cada cuánto se ofrecen horas.");

  const { data: ocupado } = await supabase.from("configuracion_agenda").select("organization_id").eq("reserva_slug", slug).neq("organization_id", organizacion).maybeSingle();
  if (ocupado) throw new Error("Ese enlace ya lo usa otra empresa. Prueba con otro.");

  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    reserva_activa: activa,
    reserva_slug: slug,
    reserva_anticipacion_horas: anticipacion,
    reserva_dias: dias,
    reserva_intervalo_min: intervalo,
    reserva_mensaje: mensaje || null,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error, error.code === "23505" ? "Ese enlace ya lo usa otra empresa. Prueba con otro." : undefined);
  revalidar();
}

/**
 * El horario de atención de la empresa: por día, cerrado o uno o dos
 * tramos (mañana y tarde, con colación al medio). Reemplaza el anterior.
 */
export async function guardarHorarioEmpresa(formData: FormData) {
  const { supabase, organizacion } = await empresaYTextos();
  const filas: { organization_id: string; profesional_id: null; dia_semana: number; desde: string; hasta: string }[] = [];
  for (let dia = 1; dia <= 7; dia += 1) {
    if (formData.get(`d${dia}_abre`) !== "si") continue;
    for (const tramo of [1, 2]) {
      const desde = String(formData.get(`d${dia}_desde${tramo}`) ?? "");
      const hasta = String(formData.get(`d${dia}_hasta${tramo}`) ?? "");
      if (!desde && !hasta) continue;
      if (!HORA.test(desde) || !HORA.test(hasta)) throw new Error(`Revisa las horas del ${NOMBRE_DIA[dia]}.`);
      if (hasta <= desde) throw new Error(`El ${NOMBRE_DIA[dia]} la hora de término tiene que ser después de la de inicio.`);
      filas.push({ organization_id: organizacion, profesional_id: null, dia_semana: dia, desde, hasta });
    }
    if (!filas.some((fila) => fila.dia_semana === dia)) throw new Error(`Indica el horario del ${NOMBRE_DIA[dia]} o márcalo cerrado.`);
  }
  if (filas.length === 0) throw new Error("Abre al menos un día.");
  const { error: borrarError } = await supabase.from("horarios_atencion").delete().eq("organization_id", organizacion).is("profesional_id", null);
  if (borrarError) throw errorDeAccion(borrarError);
  const { error } = await supabase.from("horarios_atencion").insert(filas);
  if (error) throw errorDeAccion(error);
  revalidar();
}

/** Quién recibe reservas en línea y qué servicios se ofrecen. */
export async function guardarOfertaEnLinea(formData: FormData) {
  const { supabase } = await empresaYTextos();
  const profesionales = formData.getAll("profesional").map(String).filter((id) => UUID.test(id));
  const servicios = formData.getAll("servicio").map(String).filter((id) => UUID.test(id));
  const todosProfesionales = formData.getAll("profesional_visible").map(String).filter((id) => UUID.test(id));
  const todosServicios = formData.getAll("servicio_visible").map(String).filter((id) => UUID.test(id));
  if (profesionales.length === 0) throw new Error("Deja al menos una persona recibiendo reservas.");
  if (servicios.length === 0) throw new Error("Deja al menos un servicio para reservar.");

  const cambios = [
    supabase.from("profesionales").update({ en_reserva_online: true }).in("id", profesionales),
    supabase.from("sales_products").update({ en_reserva_online: true }).in("id", servicios),
  ];
  const sinProfesional = todosProfesionales.filter((id) => !profesionales.includes(id));
  const sinServicio = todosServicios.filter((id) => !servicios.includes(id));
  if (sinProfesional.length) cambios.push(supabase.from("profesionales").update({ en_reserva_online: false }).in("id", sinProfesional));
  if (sinServicio.length) cambios.push(supabase.from("sales_products").update({ en_reserva_online: false }).in("id", sinServicio));
  for (const { error } of await Promise.all(cambios)) {
    if (error) throw errorDeAccion(error);
  }
  revalidar();
}
