"use server";

import { errorDeAccion } from "@/lib/errores-de-accion";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { ESTADOS_CITA, esFechaValida, fechaEnChile, instanteEnChile, type EstadoCita } from "@/lib/citas";
import { createClient } from "@/lib/supabase/server";

/*
 * La agenda: agendar una cita y moverla de estado. Las dos pasan por la base
 * con la sesión de quien las hace; la seguridad por fila decide la empresa y
 * el permiso, y `agendar_cita` comprueba que el horario esté libre.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HORA = /^\d{2}:\d{2}$/;

function texto(formData: FormData, campo: string, largo = 300): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

export async function agendarCita(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id");
  const profesional = texto(formData, "profesional_id");
  const mascota = texto(formData, "mascota_id");
  const fecha = texto(formData, "fecha");
  const hora = texto(formData, "hora");
  const duracion = Number(texto(formData, "duracion") || 30);
  const motivo = texto(formData, "motivo");

  if (!UUID.test(cuenta)) throw new Error("Elige a quién atender.");
  if (!UUID.test(profesional)) throw new Error("Elige con quién.");
  if (mascota && !UUID.test(mascota)) throw new Error("Mascota inválida.");
  if (!esFechaValida(fecha) || !HORA.test(hora)) throw new Error("Revisa la fecha y la hora.");
  if (!Number.isInteger(duracion) || duracion < 5 || duracion > 480) throw new Error("Duración inválida.");
  if (motivo.length < 2) throw new Error("Escribe el motivo de la cita.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("agendar_cita", {
    p_cuenta: cuenta,
    p_profesional: profesional,
    p_inicio: instanteEnChile(fecha, hora).toISOString(),
    p_duracion_min: duracion,
    p_motivo: motivo,
    p_mascota: mascota || null,
    p_nota: texto(formData, "nota", 600) || null,
  });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/citas");
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  redirect(`/dashboard/citas?dia=${fecha}`);
}

export async function cambiarEstadoCita(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cita = texto(formData, "cita_id");
  const estado = texto(formData, "estado") as EstadoCita;
  const cuenta = texto(formData, "cuenta_id");
  if (!UUID.test(cita)) throw new Error("Cita inválida.");
  if (!ESTADOS_CITA.includes(estado)) throw new Error("Estado desconocido.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("cambiar_estado_cita", { p_cita: cita, p_estado: estado });
  if (error) throw errorDeAccion(error);

  revalidatePath("/dashboard/citas");
  revalidatePath("/dashboard/recordatorios");
  revalidatePath("/dashboard");
  if (UUID.test(cuenta)) revalidatePath(`/dashboard/pacientes/${cuenta}`);

  // Dar por atendida abre la ficha para registrar lo que se hizo: de la
  // consulta salen el cobro y la próxima cita.
  if (estado === "atendida" && formData.get("abrir_ficha") === "si" && UUID.test(cuenta)) {
    redirect(`/dashboard/pacientes/${cuenta}`);
  }
  const volver = texto(formData, "volver");
  if (volver.startsWith("/dashboard/")) redirect(volver);
  redirect(`/dashboard/citas?dia=${fechaEnChile(new Date())}`);
}

/*
 * Búsqueda para el selector de «Nueva cita». La pantalla carga las primeras
 * personas y mascotas; cuando la empresa tiene más, el selector pregunta acá
 * para no dejar a nadie fuera. El patrón es tolerante (vocales y ñ como
 * comodín, RUT sin puntos ni guion) y el cliente vuelve a filtrar ignorando
 * tildes, así que lo que se muestra coincide de verdad con lo escrito.
 */

export type OpcionDeCita = {
  value: string;
  label: string;
  detalle?: string;
  /** Persona dueña, en las mascotas. */
  cuentaId?: string;
  cuentaNombre?: string;
};

const MAX_RESULTADOS = 50;

function patronTolerante(consulta: string): string | null {
  const limpia = consulta.replace(/[%_,()*\\"]/g, " ").replace(/\s+/g, " ").trim();
  if (limpia.length < 2) return null;
  return `%${limpia.replace(/[aeiouáéíóúünñ]/gi, "_").replace(/ /g, "%")}%`;
}

export async function buscarCuentasParaCita(consulta: string): Promise<OpcionDeCita[]> {
  await requireProfile(["admin", "supervisor"]);
  const patron = patronTolerante(String(consulta ?? "").slice(0, 80));
  if (!patron) return [];
  const rut = String(consulta).replace(/[^0-9kK]/g, "").toUpperCase();

  const supabase = await createClient();
  const filtros = [`name.ilike.${patron}`];
  if (rut.length >= 3) filtros.push(`normalized_rut.ilike.%${rut}%`);
  const { data, error } = await supabase
    .from("sales_companies")
    .select("id, name, rut")
    .or(filtros.join(","))
    .order("name")
    .limit(MAX_RESULTADOS);
  if (error) throw errorDeAccion(error, "No se pudo buscar. Inténtalo de nuevo.");
  return (data ?? []).map((cuenta) => ({
    value: cuenta.id as string,
    label: cuenta.name as string,
    detalle: (cuenta.rut as string | null) ?? undefined,
  }));
}

export async function buscarMascotasParaCita(consulta: string, cuentaId?: string | null): Promise<OpcionDeCita[]> {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = cuentaId && UUID.test(cuentaId) ? cuentaId : null;
  const patron = patronTolerante(String(consulta ?? "").slice(0, 80));
  // Sin texto solo tiene sentido pedir las mascotas de una persona ya elegida.
  if (!patron && !cuenta) return [];

  const supabase = await createClient();
  let pedido = supabase.from("mascotas").select("id, nombre, especie, cuenta_id, sales_companies(name)").order("nombre").limit(MAX_RESULTADOS);
  if (patron) pedido = pedido.ilike("nombre", patron);
  if (cuenta) pedido = pedido.eq("cuenta_id", cuenta);
  const { data, error } = await pedido;
  if (error) throw errorDeAccion(error, "No se pudo buscar. Inténtalo de nuevo.");
  return (data ?? []).map((mascota) => {
    const tutor = mascota.sales_companies as { name?: string } | { name?: string }[] | null;
    const nombreTutor = (Array.isArray(tutor) ? tutor[0]?.name : tutor?.name) ?? "";
    return {
      value: mascota.id as string,
      label: mascota.nombre as string,
      detalle: [mascota.especie, nombreTutor].filter(Boolean).join(" · "),
      cuentaId: mascota.cuenta_id as string,
      cuentaNombre: nombreTutor,
    };
  });
}
