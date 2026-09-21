"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/*
 * Fichas de pacientes y tutores.
 *
 * El alta, las vacunas y las notas pasan por la base con la sesión de quien las
 * hace: la seguridad por fila decide la empresa y el permiso. Acá solo se lee
 * el formulario.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "").trim();
}

export async function crearPaciente(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const nombre = texto(formData, "nombre");
  if (nombre.length < 3) throw new Error("Escribe nombre y apellido.");

  const datos: Record<string, string> = {};
  for (const campo of ["prevision", "profesional", "comuna", "origen", "nacimiento"]) {
    const valor = texto(formData, campo);
    if (valor) datos[campo] = valor;
  }
  const mascota = texto(formData, "mascota")
    ? {
        nombre: texto(formData, "mascota"),
        especie: texto(formData, "especie") || "Perro",
        raza: texto(formData, "raza"),
        sexo: texto(formData, "sexo"),
      }
    : null;
  if (mascota) {
    datos.mascota = mascota.nombre;
    datos.especie = mascota.especie;
    if (mascota.raza) datos.raza = mascota.raza;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crear_paciente", {
    p_nombre: nombre,
    p_telefono: texto(formData, "telefono") || null,
    p_email: texto(formData, "email") || null,
    p_rut: texto(formData, "rut") || null,
    p_datos: datos,
    p_mascota: mascota,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/pacientes");
  redirect(`/dashboard/pacientes/${data}`);
}

export async function registrarCuidado(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const mascota = texto(formData, "mascota_id");
  const tipo = texto(formData, "tipo");
  const cuenta = texto(formData, "cuenta_id");
  if (!UUID.test(mascota) || !UUID.test(cuenta)) throw new Error("Mascota inválida.");
  if (tipo !== "vacuna" && tipo !== "desparasitacion") throw new Error("Elige vacuna o desparasitación.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_cuidado_de_mascota", { p_mascota: mascota, p_tipo: tipo });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  revalidatePath("/dashboard/pacientes");
}

export async function agregarNota(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id");
  const nota = texto(formData, "nota");
  const tipo = texto(formData, "tipo") || "nota";
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (nota.length < 2) throw new Error("Escribe la nota.");
  if (!["nota", "llamada", "correo", "whatsapp", "reunion"].includes(tipo)) throw new Error("Tipo inválido.");

  const supabase = await createClient();
  const { data: ficha, error: lectura } = await supabase
    .from("sales_companies")
    .select("organization_id")
    .eq("id", cuenta)
    .single();
  if (lectura || !ficha) throw new Error("No encontramos esa ficha.");

  const { error } = await supabase.from("sales_activities").insert({
    organization_id: ficha.organization_id,
    company_id: cuenta,
    kind: tipo,
    subject: nota,
    occurred_at: new Date().toISOString(),
    done: true,
    owner_id: profile.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}
