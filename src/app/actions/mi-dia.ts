"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { createClient } from "@/lib/supabase/server";

/*
 * El profesional marca sus propias citas. La base comprueba que la cita sea
 * suya y que el cambio sea uno de los que le tocan (en sala, atendida, no vino).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function marcarMiCita(formData: FormData) {
  await requireProfile();
  const cita = String(formData.get("cita_id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  if (!UUID.test(cita)) throw new Error("Cita inválida.");
  if (!["en_sala", "atendida", "no_vino"].includes(estado)) throw new Error("Ese cambio lo hace la recepción.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_mi_cita", { p_cita: cita, p_estado: estado });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/mi-dia");
  revalidatePath("/dashboard/citas");
}
