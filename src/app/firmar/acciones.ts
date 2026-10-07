"use server";

import { clientePublico } from "@/lib/reserva.server";

/** Firmar desde el enlace: sin sesión, el token largo es la llave. */
export async function firmarDesdeEnlace(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const token = String(formData.get("token") ?? "");
  if (!/^[a-f0-9]{32,64}$/.test(token)) return { ok: false, error: "Este enlace no es válido." };
  const { data, error } = await clientePublico().rpc("firmar_consentimiento_publico", {
    p_token: token,
    p_nombre: String(formData.get("nombre") ?? "").slice(0, 120),
    p_rut: String(formData.get("rut") ?? "").slice(0, 20) || null,
    p_firma: String(formData.get("firma") ?? "").slice(0, 200000),
  });
  if (error) return { ok: false, error: error.code === "22023" ? error.message : "No pudimos guardar la firma. Inténtalo de nuevo." };
  return data === true ? { ok: true } : { ok: false, error: "Este documento ya fue firmado o anulado." };
}
