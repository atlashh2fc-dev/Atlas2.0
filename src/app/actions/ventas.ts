"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/*
 * Embudo B2B.
 *
 * Las reglas (empresa dueña, etapa inicial, precio del catálogo, rastro de cada
 * movimiento) viven en la base. Acá solo se valida lo que escribió la persona y
 * se llama al RPC con su sesión, para que la frontera de empresa se aplique sola.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GESTIONES = ["llamada", "correo", "whatsapp", "reunion", "nota", "tarea"] as const;

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "").trim();
}

function numero(formData: FormData, campo: string): number {
  const bruto = texto(formData, campo).replace(/[^\d]/g, "");
  return bruto === "" ? 0 : Number(bruto);
}

export async function crearOportunidad(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const empresa = texto(formData, "empresa");
  const nombre = texto(formData, "nombre");
  const cierre = texto(formData, "cierre_estimado");

  if (empresa.length < 2) throw new Error("Escribe a quién se le vende.");
  if (nombre.length < 2) throw new Error("Escribe de qué se trata el negocio.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("crear_oportunidad_b2b", {
    p_company_name: empresa,
    p_opportunity_name: nombre,
    p_rut: texto(formData, "rut") || null,
    // En Dental y Vet no hay contacto aparte: la persona es su propio contacto,
    // y así su teléfono y su correo quedan guardados igual que en una empresa.
    p_contact_name:
      texto(formData, "contacto") ||
      (texto(formData, "contacto_email") || texto(formData, "contacto_telefono") ? empresa : null),
    p_contact_email: texto(formData, "contacto_email") || null,
    p_contact_phone: texto(formData, "contacto_telefono") || null,
    p_product_code: texto(formData, "producto") || null,
    p_monthly_amount: numero(formData, "monto_mensual"),
    p_one_time_amount: numero(formData, "monto_unico"),
    p_source: texto(formData, "origen") || null,
    p_expected_close_date: cierre === "" ? null : cierre,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/ventas");
}

export async function moverEtapa(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const oportunidad = texto(formData, "oportunidad_id");
  const etapa = texto(formData, "etapa");
  if (!UUID.test(oportunidad)) throw new Error("Oportunidad inválida.");
  if (!etapa) throw new Error("Elige una etapa.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("mover_oportunidad_de_etapa", {
    p_opportunity_id: oportunidad,
    p_stage_key: etapa,
    p_note: texto(formData, "nota") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/ventas");
  revalidatePath(`/dashboard/ventas/${oportunidad}`);
}

export async function registrarGestion(formData: FormData) {
  await requireProfile(["admin", "supervisor"]);
  const oportunidad = texto(formData, "oportunidad_id");
  const tipo = texto(formData, "tipo");
  const asunto = texto(formData, "asunto");
  const vence = texto(formData, "vence");

  if (!UUID.test(oportunidad)) throw new Error("Oportunidad inválida.");
  if (!GESTIONES.includes(tipo as (typeof GESTIONES)[number])) {
    throw new Error("Elige un tipo de gestión.");
  }
  if (asunto.length < 2) throw new Error("Escribe qué pasó o qué hay que hacer.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_actividad_b2b", {
    p_opportunity_id: oportunidad,
    p_kind: tipo,
    p_subject: asunto,
    p_body: texto(formData, "detalle") || null,
    p_due_at: vence === "" ? null : new Date(vence).toISOString(),
    p_next_action_note: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/ventas");
  revalidatePath(`/dashboard/ventas/${oportunidad}`);
}
