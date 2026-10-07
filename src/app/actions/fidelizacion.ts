"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

/*
 * Lo que hace volver: giftcards (se venden con código y saldo, se canjean
 * en una o varias visitas) y la tarjeta de sellos (cada visita suma uno; al
 * completar la meta se canjea el premio).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIOS = ["efectivo", "debito", "credito", "transferencia", "otro"];

function texto(formData: FormData, campo: string, largo = 120): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

function pesos(formData: FormData, campo: string): number {
  return Number(texto(formData, campo, 20).replace(/[^\d]/g, "") || 0);
}

function revalidar(cuenta?: string) {
  revalidatePath("/dashboard/caja/mostrador");
  if (cuenta && UUID.test(cuenta)) revalidatePath(`/dashboard/pacientes/${cuenta}`);
}

export async function venderGiftcard(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const medio = texto(formData, "medio", 20);
  if (!MEDIOS.includes(medio)) throw new Error("Elige el medio de pago.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vender_giftcard", {
    p_monto: pesos(formData, "monto"),
    p_medio: medio,
    p_para: texto(formData, "para", 80) || null,
    p_comprador: null,
    p_vence: texto(formData, "vence", 10) || null,
  });
  if (error) throw errorDeAccion(error);
  revalidar();
  // El código se muestra grande en el mostrador para entregarlo o anotarlo.
  redirect(`/dashboard/caja/mostrador?giftcard=${encodeURIComponent(data as string)}`);
}

export async function canjearGiftcard(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id", 40);
  const supabase = await createClient();
  const { error } = await supabase.rpc("canjear_giftcard", {
    p_codigo: texto(formData, "codigo", 12),
    p_monto: pesos(formData, "monto"),
    p_cuenta: UUID.test(cuenta) ? cuenta : null,
  });
  if (error) throw errorDeAccion(error);
  revalidar(cuenta);
}

export async function canjearSellos(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id", 40);
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("canjear_sellos", { p_cuenta: cuenta });
  if (error) throw errorDeAccion(error);
  revalidar(cuenta);
}

export async function guardarTarjetaDeSellos(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: organizacion } = await supabase.rpc("current_org_id");
  if (typeof organizacion !== "string") throw new Error("Elige una empresa.");
  const meta = Number(texto(formData, "sellos_meta", 3));
  if (!Number.isInteger(meta) || meta < 2 || meta > 50) throw new Error("La meta va de 2 a 50 visitas.");
  const premio = texto(formData, "sellos_premio", 120);
  const activa = formData.get("sellos_activa") === "si";
  if (activa && premio.length < 3) throw new Error("Escribe el premio.");
  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    sellos_activa: activa,
    sellos_meta: meta,
    sellos_premio: premio || null,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/citas/configuracion");
}
