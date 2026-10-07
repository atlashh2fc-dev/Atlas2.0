"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { esFechaValida } from "@/lib/citas";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

/*
 * Órdenes de laboratorio (Dental): qué trabajo salió, a qué laboratorio,
 * cuándo vuelve y en qué va. La recepción ve lo atrasado sin llamar.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type EstadoOrden = "enviada" | "en_prueba" | "recibida" | "instalada" | "cancelada";
const ESTADOS: EstadoOrden[] = ["enviada", "en_prueba", "recibida", "instalada", "cancelada"];

function texto(formData: FormData, campo: string, largo = 200): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

export async function crearOrdenLaboratorio(formData: FormData) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id", 40);
  const laboratorio = texto(formData, "laboratorio", 80);
  const trabajo = texto(formData, "trabajo", 120);
  const entrega = texto(formData, "entrega_estimada", 10);
  const profesional = texto(formData, "profesional_id", 40);
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (laboratorio.length < 2) throw new Error("Escribe el laboratorio.");
  if (trabajo.length < 2) throw new Error("Escribe el trabajo (corona, prótesis, férula…).");
  if (entrega && !esFechaValida(entrega)) throw new Error("Revisa la fecha de entrega.");
  const supabase = await createClient();
  const { data: organizacion } = await supabase.rpc("current_org_id");
  if (typeof organizacion !== "string") throw new Error("Elige una empresa.");
  const costo = Number(texto(formData, "costo", 20).replace(/[^\d]/g, "") || 0);
  const { error } = await supabase.from("ordenes_laboratorio").insert({
    organization_id: organizacion,
    cuenta_id: cuenta,
    laboratorio,
    trabajo,
    piezas: texto(formData, "piezas", 60) || null,
    color: texto(formData, "color", 20) || null,
    profesional_id: UUID.test(profesional) ? profesional : null,
    entrega_estimada: entrega || null,
    costo: costo || null,
    nota: texto(formData, "nota", 400) || null,
    creado_por: profile.id,
  });
  if (error) throw errorDeAccion(error);
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
  revalidatePath("/dashboard/laboratorio");
}

export async function cambiarEstadoOrden(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = texto(formData, "id", 40);
  const estado = texto(formData, "estado", 20) as EstadoOrden;
  const cuenta = texto(formData, "cuenta_id", 40);
  if (!UUID.test(id) || !ESTADOS.includes(estado)) throw new Error("Cambio inválido.");
  const supabase = await createClient();
  const { error } = await supabase.from("ordenes_laboratorio").update({ estado, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/laboratorio");
  if (UUID.test(cuenta)) revalidatePath(`/dashboard/pacientes/${cuenta}`);
}
