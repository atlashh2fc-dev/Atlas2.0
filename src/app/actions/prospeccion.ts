"use server";

import { errorDeAccion } from "@/lib/errores-de-accion";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { esResultado } from "@/lib/prospeccion";
import { createClient } from "@/lib/supabase/server";

/*
 * Lo que se hace con un prospecto en la bandeja. La base decide la empresa, el
 * permiso y cuándo vuelve a aparecer; acá solo se valida la forma.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidar() {
  revalidatePath("/dashboard/ventas/prospeccion");
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard");
}

export async function registrarToque(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const leadId = String(formData.get("lead_id") ?? "").trim();
  const resultado = String(formData.get("resultado") ?? "").trim();
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 1000);
  const dias = Number.parseInt(String(formData.get("dias") ?? ""), 10);
  if (!UUID.test(leadId)) throw new Error("Prospecto inválido.");
  if (!esResultado(resultado)) throw new Error("Resultado inválido.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registrar_toque_de_prospeccion", {
    p_lead_id: leadId,
    p_resultado: resultado,
    p_nota: nota || null,
    p_dias: Number.isFinite(dias) ? dias : null,
  });
  if (error) throw errorDeAccion(error);
  revalidar();

  // Interesado es el paso al pipeline: se sigue trabajando en el negocio.
  const negocio = (data as { opportunity_id?: string | null } | null)?.opportunity_id;
  if (resultado === "interesado" && negocio) redirect(`/dashboard/ventas/${negocio}`);
}

/** Deshacer un toque propio de las últimas 24 horas (la política lo acota). */
export async function deshacerToque(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const id = String(formData.get("toque_id") ?? "").trim();
  if (!UUID.test(id)) throw new Error("Gestión inválida.");
  const supabase = await createClient();
  const { error } = await supabase.from("prospeccion_toques").delete().eq("id", id);
  if (error) throw errorDeAccion(error);
  revalidar();
}
