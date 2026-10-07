"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { configuracionDesdeFila, HORAS_DE_ENVIO } from "@/lib/configuracion-agenda";
import { errorDeAccion } from "@/lib/errores-de-accion";
import { PLANTILLAS_EDITABLES, validarTextoPropio, type ClavePlantilla } from "@/lib/mensajes/plantillas";
import { createClient } from "@/lib/supabase/server";

/*
 * La configuración de la agenda. Solo un administrador la cambia; la fila es
 * de su empresa (la seguridad por fila lo impone) y se crea la primera vez.
 */

async function empresaYTextos() {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: organizacion } = await supabase.rpc("current_org_id");
  if (typeof organizacion !== "string") throw new Error("No sabemos de qué empresa es la agenda. Vuelve a entrar.");
  const { data, error } = await supabase.from("configuracion_agenda").select("*").eq("organization_id", organizacion).maybeSingle();
  if (error) throw errorDeAccion(error);
  return { supabase, organizacion, profile, actual: configuracionDesdeFila(data) };
}

function revalidar() {
  revalidatePath("/dashboard/citas/configuracion");
  revalidatePath("/dashboard/recordatorios");
  revalidatePath("/dashboard/citas");
}

export async function guardarRecordatorios(formData: FormData) {
  const { supabase, organizacion, profile, actual } = await empresaYTextos();
  const dias = Number(formData.get("recordatorio_dias_antes"));
  const desde = String(formData.get("recordatorio_desde") ?? "");
  if (!Number.isInteger(dias) || dias < 0 || dias > 3) throw new Error("Elige con cuánta anticipación sale el recordatorio.");
  if (!HORAS_DE_ENVIO.includes(desde)) throw new Error("Elige desde qué hora sale.");
  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    recordatorio_dias_antes: dias,
    recordatorio_desde: desde,
    confirmacion_automatica: formData.get("confirmacion_automatica") === "si",
    textos: actual.textos,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}

export async function guardarTextoPropio(formData: FormData) {
  const { supabase, organizacion, profile, actual } = await empresaYTextos();
  const clave = String(formData.get("plantilla") ?? "") as ClavePlantilla;
  if (!(clave in PLANTILLAS_EDITABLES)) throw new Error("Ese mensaje no se puede editar.");
  const texto = String(formData.get("texto") ?? "").trim();
  const restaurar = formData.get("restaurar") === "si";
  if (!restaurar) {
    const problema = validarTextoPropio(clave, texto);
    if (problema) throw new Error(problema);
  }
  const textos = { ...actual.textos };
  if (restaurar) delete textos[clave];
  else textos[clave] = texto;
  const { error } = await supabase.from("configuracion_agenda").upsert({
    organization_id: organizacion,
    recordatorio_dias_antes: actual.recordatorio_dias_antes,
    recordatorio_desde: actual.recordatorio_desde,
    confirmacion_automatica: actual.confirmacion_automatica,
    textos,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw errorDeAccion(error);
  revalidar();
}
