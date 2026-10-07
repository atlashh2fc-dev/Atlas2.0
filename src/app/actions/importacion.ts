"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { mensajeDeError } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

export type ResultadoImportacion =
  | { ok: true; creadas: number; actualizadas: number; mascotas: number; omitidas: number; errores: { fila: number; motivo: string }[] }
  | { ok: false; error: string };

const CAMPOS = new Set(["nombre", "rut", "telefono", "correo", "comuna", "mascota", "especie", "raza", "sexo", "nacimiento", "nota"]);

/**
 * Importa las filas que el navegador leyó de la planilla. La base busca a
 * cada persona por celular, RUT o correo antes de crearla, así que volver a
 * subir la misma planilla no duplica fichas.
 */
export async function importarFichas(filas: Record<string, string>[]): Promise<ResultadoImportacion> {
  await requireProfile(["admin", "supervisor"]);
  if (!Array.isArray(filas) || filas.length === 0) return { ok: false, error: "La planilla no trae filas." };
  if (filas.length > 5000) return { ok: false, error: "Máximo 5.000 filas por vez: divide la planilla." };
  const limpias = filas.map((fila) =>
    Object.fromEntries(Object.entries(fila ?? {}).filter(([campo, valor]) => CAMPOS.has(campo) && typeof valor === "string").map(([campo, valor]) => [campo, valor.slice(0, 300)])),
  );
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("importar_fichas", { p_filas: limpias });
  if (error) return { ok: false, error: mensajeDeError(error, "No se pudo importar. Inténtalo de nuevo.") };
  revalidatePath("/dashboard/pacientes");
  return { ok: true, ...(data as Omit<Extract<ResultadoImportacion, { ok: true }>, "ok">) };
}
