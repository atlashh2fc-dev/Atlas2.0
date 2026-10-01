"use server";

import { errorDeAccion } from "@/lib/errores-de-accion";
import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/*
 * El buzón de la clínica. La clave viaja una sola vez a la base, que la deja
 * en el Vault; acá no se guarda ni se registra.
 */

function texto(formData: FormData, campo: string, largo = 200): string {
  return String(formData.get(campo) ?? "").trim().slice(0, largo);
}

export async function guardarBuzon(formData: FormData) {
  await requireProfile(["admin"]);
  const address = texto(formData, "address").toLowerCase();
  if (!address.includes("@")) throw new Error("Escribe la dirección del buzón.");
  const imapPort = Number(texto(formData, "imap_port", 6) || 993);
  const smtpPort = Number(texto(formData, "smtp_port", 6) || 465);
  if (!Number.isInteger(imapPort) || !Number.isInteger(smtpPort) || imapPort < 1 || smtpPort < 1) throw new Error("Revisa los puertos.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_buzon_de_clinica", {
    p_address: address,
    p_label: texto(formData, "label") || null,
    p_imap_host: texto(formData, "imap_host") || null,
    p_imap_port: imapPort,
    p_smtp_host: texto(formData, "smtp_host") || null,
    p_smtp_port: smtpPort,
    p_usuario: texto(formData, "usuario") || null,
    p_clave: texto(formData, "clave", 400) || null,
    p_remitente: texto(formData, "remitente") || null,
  });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/admin/correo");
  revalidatePath("/dashboard/mensajes");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un buzón de envío del contact center y las campañas que lo usan. Sin id,
 * crea uno nuevo; la clave es obligatoria solo al crearlo.
 */
export async function guardarBuzonDeEnvio(formData: FormData) {
  await requireProfile(["admin"]);
  const id = texto(formData, "id", 40);
  const address = texto(formData, "address").toLowerCase();
  if (!address.includes("@")) throw new Error("Escribe la dirección del buzón.");
  const imapPort = Number(texto(formData, "imap_port", 6) || 993);
  const smtpPort = Number(texto(formData, "smtp_port", 6) || 465);
  if (!Number.isInteger(imapPort) || !Number.isInteger(smtpPort) || imapPort < 1 || smtpPort < 1) throw new Error("Revisa los puertos.");
  const campanas = [...new Set(formData.getAll("campanas").map(String).filter((valor) => UUID.test(valor)))];

  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_buzon_de_envio", {
    p_id: UUID.test(id) ? id : null,
    p_address: address,
    p_label: texto(formData, "label") || null,
    p_imap_host: texto(formData, "imap_host") || null,
    p_imap_port: imapPort,
    p_smtp_host: texto(formData, "smtp_host") || null,
    p_smtp_port: smtpPort,
    p_usuario: texto(formData, "usuario") || null,
    p_clave: texto(formData, "clave", 400) || null,
    p_remitente: texto(formData, "remitente") || null,
    p_campanas: campanas,
  });
  if (error) throw errorDeAccion(error);
  revalidatePath("/dashboard/admin/correo");
}
