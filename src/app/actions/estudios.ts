"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { TIPOS_ARCHIVO, TIPOS_ESTUDIO, TAMANO_MAXIMO } from "@/lib/estudios";
import { createClient } from "@/lib/supabase/server";

/*
 * Estudios clínicos. El archivo ya lo subió el navegador al bucket privado
 * (la política del bucket exige que la carpeta sea de la empresa de quien sube);
 * acá se registra qué es y a qué pieza o zona pertenece.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(formData: FormData, campo: string, largo = 400): string | null {
  const valor = String(formData.get(campo) ?? "").trim().slice(0, largo);
  return valor === "" ? null : valor;
}

export async function registrarEstudio(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id") ?? "";
  const ruta = texto(formData, "storage_path", 300) ?? "";
  const tipo = texto(formData, "tipo") ?? "radiografia";
  const mime = texto(formData, "mime", 80) ?? "";
  const titulo = texto(formData, "titulo", 160);
  const mascota = texto(formData, "mascota_id");
  const piezaTexto = texto(formData, "pieza");
  const fecha = texto(formData, "fecha");
  const tamano = Number(formData.get("tamano") ?? 0);

  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (mascota && !UUID.test(mascota)) throw new Error("Mascota inválida.");
  if (!(TIPOS_ESTUDIO as readonly string[]).includes(tipo)) throw new Error("Tipo de estudio inválido.");
  if (!(TIPOS_ARCHIVO as readonly string[]).includes(mime)) throw new Error("Ese tipo de archivo no se puede adjuntar.");
  if (!titulo) throw new Error("Ponle un nombre al estudio.");
  if (fecha && !FECHA.test(fecha)) throw new Error("Fecha inválida.");
  if (tamano > TAMANO_MAXIMO) throw new Error("El archivo supera los 25 MB.");
  // La ruta la armó el navegador: tiene que caer en la carpeta de esta ficha.
  const partes = ruta.split("/");
  if (partes.length !== 3 || !UUID.test(partes[0]) || partes[1] !== cuenta) throw new Error("Ruta de archivo inválida.");

  const supabase = await createClient();
  const { data: ficha, error: lectura } = await supabase.from("sales_companies").select("organization_id").eq("id", cuenta).single();
  if (lectura || !ficha) throw new Error("No encontramos esa ficha.");

  const { error } = await supabase.from("estudios_clinicos").insert({
    organization_id: ficha.organization_id,
    cuenta_id: cuenta,
    mascota_id: mascota,
    pieza: piezaTexto ? Number(piezaTexto) : null,
    region: texto(formData, "region", 60),
    tipo,
    titulo,
    nota: texto(formData, "nota", 1000),
    storage_path: ruta,
    mime,
    tamano: Number.isFinite(tamano) && tamano > 0 ? Math.round(tamano) : null,
    ...(fecha ? { fecha } : {}),
    subido_por: profile.id,
  });
  if (error) throw new Error(error.message);

  await supabase.from("sales_activities").insert({
    organization_id: ficha.organization_id,
    company_id: cuenta,
    kind: "nota",
    subject: `Estudio adjunto: ${titulo}${piezaTexto ? ` · pieza ${piezaTexto}` : ""}`,
    occurred_at: new Date().toISOString(),
    done: true,
    owner_id: profile.id,
  });

  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}
