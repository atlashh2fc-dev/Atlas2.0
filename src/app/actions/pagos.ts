"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { esMedioEnCaja } from "@/lib/pagos/medios";
import { createClient } from "@/lib/supabase/server";

/*
 * Caja: un pago en el mesón (efectivo, tarjeta en el POS, transferencia)
 * queda pagado al tiro; un cobro en línea nace pendiente y lo cierra la
 * pasarela cuando la persona paga. Las dos cosas pasan por la base con la
 * sesión de quien cobra.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string, largo = 200): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

function monto(formData: FormData): number {
  const bruto = String(formData.get("monto") ?? "").replace(/[^\d]/g, "");
  const valor = Number(bruto);
  if (!bruto || !Number.isFinite(valor) || valor <= 0 || valor > 100_000_000) throw new Error("Escribe un monto válido.");
  return valor;
}

function revalidarCaja(cuenta: string) {
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/pacientes/${cuenta}`);
}

export async function registrarPago(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id");
  const medio = texto(formData, "medio");
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  if (!esMedioEnCaja(medio)) throw new Error("Elige el medio de pago.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_pago", {
    p_cuenta: cuenta,
    p_monto: monto(formData),
    p_medio: medio,
    p_referencia: texto(formData, "referencia") || null,
    p_atenciones: null,
    p_nota: texto(formData, "nota", 400) || null,
  });
  if (error) throw new Error(error.message);
  revalidarCaja(cuenta);
}

/**
 * Cobro en línea. Crea el pago pendiente y manda a la persona a la página de
 * pago, o vuelve a la caja con el enlace listo para enviar por WhatsApp.
 */
export async function cobrarEnLinea(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const cuenta = texto(formData, "cuenta_id");
  if (!UUID.test(cuenta)) throw new Error("Ficha inválida.");
  const destino = texto(formData, "destino") === "enlace" ? "enlace" : "pagar";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("iniciar_cobro_en_linea", {
    p_cuenta: cuenta,
    p_monto: monto(formData),
    p_pasarela: "transbank",
    p_atenciones: null,
  });
  if (error) throw new Error(error.message);
  const pago = data as string;
  revalidarCaja(cuenta);
  redirect(destino === "enlace" ? `/dashboard/caja?enlace=${pago}` : `/pagar/${pago}`);
}
