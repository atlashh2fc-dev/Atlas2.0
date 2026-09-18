"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/*
 * Decidir sobre lo que el agente propuso.
 *
 * En modo borrador el agente escribe y espera. Acá se marca lo que ya enviaste
 * o lo que descartaste, para que no vuelva a aparecer y para que quede claro
 * qué se hizo con cada respuesta.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function decidir(formData: FormData, estado: "enviado" | "descartado") {
  const profile = await requireProfile(["admin", "supervisor"]);
  const id = String(formData.get("borrador_id") ?? "").trim();
  if (!UUID.test(id)) throw new Error("Borrador inválido.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_agent_drafts")
    .update({ estado, decidido_por: profile.id, decidido_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/ventas/respuestas");
  revalidatePath("/dashboard/ventas");
}

export async function marcarBorradorEnviado(formData: FormData) {
  await decidir(formData, "enviado");
}

export async function descartarBorrador(formData: FormData) {
  await decidir(formData, "descartado");
}
