"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

/*
 * El mesón: vender un producto (cera, champú, alimento, cepillo) y anotar
 * una propina. Las dos quedan en la liquidación del profesional del período.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIOS = ["efectivo", "debito", "credito", "transferencia", "otro"];

function texto(formData: FormData, campo: string, largo = 120): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

/** Pesos tolerantes: «$12.000», «12000» o «12 000». */
function pesos(formData: FormData, campo: string): number | null {
  const limpio = texto(formData, campo, 20).replace(/[^\d]/g, "");
  return limpio ? Number(limpio) : null;
}

function revalidar() {
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/caja/mostrador");
  revalidatePath("/dashboard/admin/insumos");
}

export async function venderProducto(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const insumo = texto(formData, "insumo_id", 40);
  const cantidad = Number(texto(formData, "cantidad", 6).replace(",", ".") || 1);
  const medio = texto(formData, "medio", 20);
  const profesional = texto(formData, "profesional_id", 40);
  const cuenta = texto(formData, "cuenta_id", 40);
  if (!UUID.test(insumo)) throw new Error("Elige el producto.");
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("Revisa la cantidad.");
  if (!MEDIOS.includes(medio)) throw new Error("Elige el medio de pago.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("vender_producto", {
    p_insumo: insumo,
    p_cantidad: cantidad,
    p_medio: medio,
    p_precio_unitario: pesos(formData, "precio"),
    p_cuenta: UUID.test(cuenta) ? cuenta : null,
    p_profesional: UUID.test(profesional) ? profesional : null,
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}

export async function registrarPropina(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const profesional = texto(formData, "profesional_id", 40);
  const monto = pesos(formData, "monto");
  const medio = texto(formData, "medio", 20);
  if (!UUID.test(profesional)) throw new Error("Elige para quién es la propina.");
  if (!monto || monto <= 0) throw new Error("Escribe el monto.");
  if (monto > 500000) throw new Error("Revisa el monto: parece demasiado alto para una propina.");
  if (!MEDIOS.includes(medio)) throw new Error("Elige el medio de pago.");
  const supabase = await createClient();
  const { data: empresa } = await supabase.rpc("current_org_id");
  if (typeof empresa !== "string") throw new Error("Elige una empresa.");
  const profile = await requireProfile(["admin", "supervisor"]);
  const { error } = await supabase.from("propinas").insert({
    organization_id: empresa,
    profesional_id: profesional,
    monto,
    medio,
    nota: texto(formData, "nota", 200) || null,
    creado_por: profile.id,
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}
