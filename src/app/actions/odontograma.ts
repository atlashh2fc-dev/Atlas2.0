"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { AVANCES, ESTADOS, INFO_AVANCE, INFO_ESTADO, SUPERFICIES, piezaPorNumero, type Avance, type EstadoPieza } from "@/lib/odontograma";
import { createClient } from "@/lib/supabase/server";

/*
 * Odontograma: se agrega historia, nunca se sobreescribe.
 *
 * Cada registro es un hecho sobre una pieza. Además deja una línea en la
 * historia de la ficha para que la recepción vea que hubo un cambio clínico
 * sin tener que abrir el odontograma.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(formData: FormData, campo: string, largo = 400): string | null {
  const valor = String(formData.get(campo) ?? "").trim().slice(0, largo);
  return valor === "" ? null : valor;
}

export async function registrarEnOdontograma(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id") ?? "";
  const pieza = piezaPorNumero(Number(formData.get("pieza")));
  const estado = texto(formData, "estado") as EstadoPieza | null;
  const avance = (texto(formData, "avance") ?? "diagnostico") as Avance;
  const fecha = texto(formData, "fecha");

  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (!pieza) throw new Error("Pieza inválida.");
  if (!estado || !(ESTADOS as readonly string[]).includes(estado)) throw new Error("Elige el estado de la pieza.");
  if (!(AVANCES as readonly string[]).includes(avance)) throw new Error("Elige en qué va el tratamiento.");
  if (fecha && !FECHA.test(fecha)) throw new Error("Fecha inválida.");

  const superficies = INFO_ESTADO[estado].porSuperficie
    ? formData.getAll("superficies").map(String).filter((valor) => (SUPERFICIES as readonly string[]).includes(valor))
    : [];
  if (INFO_ESTADO[estado].porSuperficie && superficies.length === 0) {
    throw new Error("Marca al menos una superficie de la pieza.");
  }

  const supabase = await createClient();
  const { data: ficha, error: lectura } = await supabase
    .from("sales_companies")
    .select("organization_id")
    .eq("id", cuenta)
    .single();
  if (lectura || !ficha) throw new Error("No encontramos esa ficha.");

  const { error } = await supabase.from("odontograma_registros").insert({
    organization_id: ficha.organization_id,
    cuenta_id: cuenta,
    pieza: pieza.numero,
    superficies,
    estado,
    avance,
    sintoma: texto(formData, "sintoma"),
    diagnostico: texto(formData, "diagnostico"),
    tratamiento: texto(formData, "tratamiento"),
    profesional: texto(formData, "profesional", 120),
    nota: texto(formData, "nota", 1000),
    ...(fecha ? { fecha } : {}),
    registrado_por: profile.id,
  });
  if (error) throw new Error(error.message);

  await supabase.from("sales_activities").insert({
    organization_id: ficha.organization_id,
    company_id: cuenta,
    kind: "nota",
    subject: `Odontograma · pieza ${pieza.numero}: ${INFO_ESTADO[estado].label.toLowerCase()} (${INFO_AVANCE[avance].label.toLowerCase()})`,
    body: texto(formData, "tratamiento") ?? texto(formData, "diagnostico"),
    occurred_at: new Date().toISOString(),
    done: true,
    owner_id: profile.id,
  });

  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}
