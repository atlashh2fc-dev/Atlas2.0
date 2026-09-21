"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { REGIONES, RAZAS, TIPOS, NOMBRE_REGION, INFO_TIPO, type Region, type TipoRegistro } from "@/lib/anatomia";
import { AVANCES } from "@/lib/odontograma";
import { createClient } from "@/lib/supabase/server";

/*
 * Mapa clínico de la mascota. Se agrega historia, nunca se sobreescribe; cada
 * registro deja además una línea en la historia del tutor.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(formData: FormData, campo: string, largo = 400): string | null {
  const valor = String(formData.get(campo) ?? "").trim().slice(0, largo);
  return valor === "" ? null : valor;
}

/** El punto marcado sobre el modelo: tres números acotados, o nada. */
function punto(formData: FormData): [number, number, number] | null {
  const bruto = texto(formData, "punto", 120);
  if (!bruto) return null;
  try {
    const valor = JSON.parse(bruto) as unknown;
    if (Array.isArray(valor) && valor.length === 3 && valor.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 10)) {
      return valor as [number, number, number];
    }
  } catch {
    // Un punto ilegible no impide registrar: el marcador va al centro de la zona.
  }
  return null;
}

export async function registrarEnMascota(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const mascotaId = texto(formData, "mascota_id") ?? "";
  const region = texto(formData, "region") as Region | null;
  const tipo = texto(formData, "tipo") as TipoRegistro | null;
  const titulo = texto(formData, "titulo", 160);
  const avance = texto(formData, "avance") ?? "diagnostico";
  const fecha = texto(formData, "fecha");

  if (!UUID.test(mascotaId)) throw new Error("Mascota inválida.");
  if (!region || !(REGIONES as readonly string[]).includes(region)) throw new Error("Elige una zona del cuerpo.");
  if (!tipo || !(TIPOS as readonly string[]).includes(tipo)) throw new Error("Elige qué se registra.");
  if (!titulo) throw new Error("Escribe qué se encontró o qué se hizo.");
  if (!(AVANCES as readonly string[]).includes(avance)) throw new Error("Avance inválido.");
  if (fecha && !FECHA.test(fecha)) throw new Error("Fecha inválida.");

  const supabase = await createClient();
  const { data: mascota, error: lectura } = await supabase
    .from("mascotas")
    .select("organization_id, cuenta_id, nombre")
    .eq("id", mascotaId)
    .single();
  if (lectura || !mascota) throw new Error("No encontramos esa mascota.");

  const { error } = await supabase.from("mascota_registros").insert({
    organization_id: mascota.organization_id,
    cuenta_id: mascota.cuenta_id,
    mascota_id: mascotaId,
    region,
    punto: punto(formData),
    tipo,
    titulo,
    detalle: texto(formData, "detalle", 1000),
    avance,
    profesional: texto(formData, "profesional", 120),
    ...(fecha ? { fecha } : {}),
    registrado_por: profile.id,
  });
  if (error) throw new Error(error.message);

  await supabase.from("sales_activities").insert({
    organization_id: mascota.organization_id,
    company_id: mascota.cuenta_id,
    kind: "nota",
    subject: `${mascota.nombre} · ${NOMBRE_REGION[region].toLowerCase()}: ${INFO_TIPO[tipo].label.toLowerCase()} — ${titulo}`,
    occurred_at: new Date().toISOString(),
    done: true,
    owner_id: profile.id,
  });

  revalidatePath(`/dashboard/pacientes/${mascota.cuenta_id}`);
}

export async function cambiarRazaMascota(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const mascotaId = texto(formData, "mascota_id") ?? "";
  const raza = texto(formData, "raza", 60);
  if (!UUID.test(mascotaId)) throw new Error("Mascota inválida.");

  const supabase = await createClient();
  const { data: mascota, error: lectura } = await supabase.from("mascotas").select("especie, cuenta_id").eq("id", mascotaId).single();
  if (lectura || !mascota) throw new Error("No encontramos esa mascota.");
  if (!raza || !RAZAS.some((item) => item.especie === mascota.especie && item.nombre === raza)) {
    throw new Error("Elige una raza de la lista.");
  }

  const { error } = await supabase.from("mascotas").update({ raza, updated_at: new Date().toISOString() }).eq("id", mascotaId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/pacientes/${mascota.cuenta_id}`);
}
